/**
 * Đồng bộ tin cũ từ Zalo PC bằng nút "Đồng bộ tin nhắn cũ" trên app.
 *
 * App chạy trên NAS nên không đọc được Zalo PC trên máy khác. Mỗi máy có Zalo PC cài "chương trình đồng bộ"
 * (scripts/dong-bo-zalo-pc.mjs, chạy nền). Bấm nút → tạo việc cho kênh; chương trình trên máy nào có Zalo PC
 * đăng nhập CÙNG tài khoản Zalo với kênh thì nhận việc, đọc tin từ Zalo PC và gửi lên (history-import.ts).
 *
 * - Máy đồng bộ: Super Admin tạo trong Cài đặt › Kết nối kênh, nhận mã khóa một lần (lưu dạng băm).
 * - Mã khóa chỉ dùng cho /api/pc-agent: hỏi việc, nhận việc đang chờ, báo tiến độ, gửi tin của đúng việc đó.
 * - Máy chỉ nhận được việc khi tài khoản Zalo PC trùng tài khoản của kênh (máy chủ kiểm lúc nhận việc và mỗi lô tin).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Router, type NextFunction, type Request, type Response } from "express";
import { all, db, get, logEvent, run } from "./db.js";
import { HttpError } from "./conversations.js";
import { importHistory } from "./history-import.js";
import { publicBaseUrl } from "./platforms/common.js";
import { makeZip } from "./zip.js";

db.exec(`
CREATE TABLE IF NOT EXISTS pc_sync_agents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  created_by INTEGER,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER,
  last_uid TEXT,
  host TEXT,
  version TEXT
);
CREATE TABLE IF NOT EXISTS pc_sync_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id INTEGER NOT NULL,
  days INTEGER NOT NULL DEFAULT 90,
  status TEXT NOT NULL DEFAULT 'pending',
  requested_by INTEGER,
  agent_id INTEGER,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  heartbeat_at INTEGER,
  finished_at INTEGER,
  progress TEXT,
  declines TEXT,
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_pc_sync_jobs_channel ON pc_sync_jobs(channel_id, id);
`);

const ONLINE_MS = 45_000;
const STALE_MS = 3 * 60_000;
const hash = (key: string) => crypto.createHash("sha256").update(key).digest("hex");

type Job = {
  id: number;
  channel_id: number;
  days: number;
  status: "pending" | "running" | "done" | "error" | "cancelled";
  requested_by: number | null;
  agent_id: number | null;
  created_at: number;
  started_at: number | null;
  heartbeat_at: number | null;
  finished_at: number | null;
  progress: string | null;
  declines: string | null;
  error: string | null;
};

/** Việc đang chạy mà máy im lặng quá 3 phút → coi như máy mất liên lạc. */
function expireStale() {
  run(
    "UPDATE pc_sync_jobs SET status = 'error', error = 'Máy đồng bộ mất liên lạc giữa chừng (tắt máy / mất mạng). Bấm đồng bộ lại để làm tiếp, tin đã nhập không bị trùng.', finished_at = ? WHERE status = 'running' AND COALESCE(heartbeat_at, started_at) < ?",
    Date.now(),
    Date.now() - STALE_MS,
  );
}

const parse = (s: string | null) => {
  try {
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
};

/** Việc gần nhất của kênh, kèm tên máy và tình trạng các máy (cho giao diện). */
export function latestPcJob(channelId: number) {
  expireStale();
  const job = get<Job>("SELECT * FROM pc_sync_jobs WHERE channel_id = ? ORDER BY id DESC LIMIT 1", channelId);
  const agents = all<{ id: number; name: string; last_seen_at: number | null }>("SELECT id, name, last_seen_at FROM pc_sync_agents");
  const online = agents.filter((a) => a.last_seen_at && Date.now() - a.last_seen_at < ONLINE_MS).length;
  if (!job) return { job: null, agents: agents.length, online };
  return {
    job: {
      id: job.id,
      status: job.status,
      days: job.days,
      created_at: job.created_at,
      started_at: job.started_at,
      finished_at: job.finished_at,
      agent: job.agent_id ? agents.find((a) => a.id === job.agent_id)?.name ?? null : null,
      progress: parse(job.progress),
      declines: parse(job.declines) ?? [],
      error: job.error,
    },
    agents: agents.length,
    online,
  };
}

/** Bấm "Đồng bộ tin nhắn cũ": tạo việc cho máy có Zalo PC (bỏ qua nếu đang có việc chờ / đang chạy). */
export function requestPcSync(channelId: number, days: number, userId: number | null, onlyIfAgents = false) {
  expireStale();
  if (onlyIfAgents && !get("SELECT 1 FROM pc_sync_agents LIMIT 1")) return null;
  const ch = get<{ zalo_uid: string | null }>("SELECT zalo_uid FROM channels WHERE id = ? AND platform = 'zalo' AND deleted_at IS NULL", channelId);
  if (!ch?.zalo_uid) return null; // chưa quét QR lần nào: chưa biết tài khoản để khớp với Zalo PC
  const open = get<{ id: number }>("SELECT id FROM pc_sync_jobs WHERE channel_id = ? AND status IN ('pending', 'running')", channelId);
  if (open) return open.id;
  const d = Math.max(1, Math.min(3650, Math.round(days) || 90));
  const id = Number(run("INSERT INTO pc_sync_jobs(channel_id, days, requested_by, created_at) VALUES(?, ?, ?, ?)", channelId, d, userId, Date.now()).lastInsertRowid);
  logEvent(null, userId, "channel.pc_sync_requested", { channel: channelId, days: d, job: id });
  return id;
}

export function cancelPcSync(channelId: number, userId: number) {
  const r = run("UPDATE pc_sync_jobs SET status = 'cancelled', finished_at = ? WHERE channel_id = ? AND status IN ('pending', 'running')", Date.now(), channelId);
  if (r.changes) logEvent(null, userId, "channel.pc_sync_cancelled", { channel: channelId });
}

// ───────────── Quản lý máy đồng bộ (Super Admin, gắn vào settingsRouter) ─────────────

export function listAgents() {
  const channels = all<{ id: number; name: string; zalo_uid: string | null }>("SELECT id, name, zalo_uid FROM channels WHERE platform = 'zalo' AND deleted_at IS NULL");
  return all<{ id: number; name: string; created_at: number; last_seen_at: number | null; last_uid: string | null; host: string | null; version: string | null }>(
    "SELECT id, name, created_at, last_seen_at, last_uid, host, version FROM pc_sync_agents ORDER BY id",
  ).map((a) => ({
    ...a,
    online: !!a.last_seen_at && Date.now() - a.last_seen_at < ONLINE_MS,
    channel: a.last_uid ? channels.find((c) => c.zalo_uid === a.last_uid)?.name ?? null : null,
  }));
}

export function createAgent(name: string, userId: number) {
  const clean = name.trim().slice(0, 60);
  if (!clean) throw new HttpError(400, "Đặt tên cho máy (vd: Laptop văn phòng)");
  const key = `zpc_${crypto.randomBytes(24).toString("base64url")}`;
  const id = Number(run("INSERT INTO pc_sync_agents(name, key_hash, created_by, created_at) VALUES(?, ?, ?, ?)", clean, hash(key), userId, Date.now()).lastInsertRowid);
  logEvent(null, userId, "pc_agent.created", { id, name: clean });
  return { id, name: clean, key };
}

export function deleteAgent(id: number, userId: number) {
  const r = run("DELETE FROM pc_sync_agents WHERE id = ?", id);
  if (!r.changes) throw new HttpError(404, "Không tìm thấy máy");
  run("UPDATE pc_sync_jobs SET status = 'pending', agent_id = NULL, started_at = NULL WHERE agent_id = ? AND status = 'running'", id);
  logEvent(null, userId, "pc_agent.deleted", { id });
}

/** File .cmd của Windows cần xuống dòng kiểu CR LF */
const CRLF = String.fromCharCode(13, 10);

const CAI_DAT = [
  "@echo off",
  "chcp 65001 >nul",
  "title Cai dat may dong bo Zalo PC - Chat Sieu Toc",
  'cd /d "%~dp0"',
  'set "NODE=node"',
  "where node >nul 2>nul",
  "if errorlevel 1 (",
  '  if exist "%ProgramFiles%\\nodejs\\node.exe" (',
  '    set "NODE=%ProgramFiles%\\nodejs\\node.exe"',
  "  ) else (",
  "    echo May chua co Node.js - dang tu cai dat, khoang 1-2 phut...",
  "    winget install -e --id OpenJS.NodeJS.LTS --silent --accept-source-agreements --accept-package-agreements",
  '    set "NODE=%ProgramFiles%\\nodejs\\node.exe"',
  "  )",
  ")",
  '"%NODE%" -v >nul 2>nul',
  "if errorlevel 1 (",
  "  echo.",
  "  echo Khong tu cai duoc Node.js. Tai ban LTS tai https://nodejs.org , cai xong bam lai file nay.",
  "  start https://nodejs.org",
  "  pause",
  "  exit /b 1",
  ")",
  '"%NODE%" "%~dp0dong-bo-zalo-pc.mjs" --cai-dat "%~dp0cau-hinh.json"',
  "echo.",
  "pause",
].join(CRLF);

const GO_CAI_DAT = [
  "@echo off",
  "chcp 65001 >nul",
  'set "NODE=node"',
  'where node >nul 2>nul || set "NODE=%ProgramFiles%\\nodejs\\node.exe"',
  '"%NODE%" "%APPDATA%\\ChatSieuToc\\dong-bo-zalo-pc.mjs" --go',
  "echo.",
  "pause",
].join(CRLF);

/**
 * Bộ cài máy đồng bộ (.zip): giải nén, bấm đúp "CAI DAT.cmd" là xong (tự cài Node.js nếu thiếu, gắn mã máy,
 * chạy nền + tự chạy khi mở máy). agentId có sẵn = tạo lại bộ cài cho máy đó (đổi mã, mã cũ hết hiệu lực).
 */
export function buildInstaller(agentId: number | null, name: string, userId: number) {
  const script = agentScriptPath();
  if (!script) throw new HttpError(404, "Bản này chưa kèm chương trình đồng bộ");
  let agent: { id: number; name: string; key: string };
  if (agentId) {
    const row = get<{ id: number; name: string }>("SELECT id, name FROM pc_sync_agents WHERE id = ?", agentId);
    if (!row) throw new HttpError(404, "Không tìm thấy máy");
    const key = `zpc_${crypto.randomBytes(24).toString("base64url")}`;
    run("UPDATE pc_sync_agents SET key_hash = ? WHERE id = ?", hash(key), row.id);
    logEvent(null, userId, "pc_agent.key_rotated", { id: row.id });
    agent = { ...row, key };
  } else agent = createAgent(name, userId);
  const huongDan = [
    `Bộ cài máy đồng bộ Zalo PC — máy "${agent.name}" — Chat Siêu Tốc (${publicBaseUrl()})`,
    "",
    "1. Giải nén file .zip này (chuột phải › Extract All / Giải nén tất cả).",
    '2. Bấm đúp "CAI DAT.cmd". Windows hỏi thì chọn Run / Vẫn chạy.',
    "   Máy chưa có Node.js thì bộ cài tự cài (1–2 phút, có thể hỏi quyền quản trị: chọn Yes).",
    '3. Thấy báo "ĐÃ CÀI XONG" là xong. Chương trình chạy nền và tự chạy mỗi khi mở máy.',
    "",
    "Sau đó trên app: đăng nhập Zalo PC đúng tài khoản Zalo của kênh, rồi bấm \"Đồng bộ tin nhắn cũ\" ở kênh đó.",
    'Gỡ: bấm đúp "GO CAI DAT.cmd" (và xóa máy trên app).',
    "",
    "File cau-hinh.json chứa mã máy bí mật: không gửi cho người ngoài. Cài xong có thể xóa thư mục này.",
  ].join(CRLF);
  const zip = makeZip([
    { name: "CAI DAT.cmd", data: CAI_DAT },
    { name: "GO CAI DAT.cmd", data: GO_CAI_DAT },
    { name: "HUONG DAN.txt", data: "\ufeff" + huongDan },
    { name: "dong-bo-zalo-pc.mjs", data: fs.readFileSync(script) },
    { name: "cau-hinh.json", data: JSON.stringify({ base: publicBaseUrl(), key: agent.key, name: agent.name }, null, 2) },
  ]);
  const ascii = agent.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").replace(/[^\w -]+/g, "").trim() || "may";
  return { zip, filename: `Cai dat dong bo Zalo PC - ${ascii}.zip` };
}

/** File chương trình đồng bộ để tải về máy có Zalo PC (bản build: /app/agent, khi chạy dev: scripts/). */
export function agentScriptPath() {
  for (const p of [path.resolve(process.cwd(), "../agent/dong-bo-zalo-pc.mjs"), path.resolve(process.cwd(), "../scripts/dong-bo-zalo-pc.mjs")]) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// ───────────── API cho chương trình đồng bộ (mã khóa máy) ─────────────

type AgentReq = Request & { agent?: { id: number; name: string } };
export const pcAgentRouter = Router();

function requireAgent(req: AgentReq, res: Response, next: NextFunction) {
  const h = req.header("authorization") ?? "";
  const key = h.startsWith("Agent ") ? h.slice(6).trim() : "";
  const agent = key ? get<{ id: number; name: string }>("SELECT id, name FROM pc_sync_agents WHERE key_hash = ?", hash(key)) : undefined;
  if (!agent) return res.status(401).json({ error: "Mã máy đồng bộ không đúng hoặc đã bị xóa. Tạo máy mới trong Cài đặt › Kết nối kênh." });
  // Mọi lần gọi đều tính là máy đang bật (lúc đang đọc Zalo PC máy không gửi /hello)
  run("UPDATE pc_sync_agents SET last_seen_at = ? WHERE id = ?", Date.now(), agent.id);
  req.agent = agent;
  next();
}
pcAgentRouter.use(requireAgent);

const wrap = (fn: (req: AgentReq, res: Response) => unknown) => (req: Request, res: Response, next: NextFunction) => {
  try {
    const r = fn(req as AgentReq, res);
    if (r instanceof Promise) r.catch(next);
  } catch (e) {
    next(e);
  }
};

function agentJob(req: AgentReq, statuses: Job["status"][]) {
  const job = get<Job>("SELECT * FROM pc_sync_jobs WHERE id = ?", Number(req.params.id));
  if (!job || job.agent_id !== req.agent!.id) throw new HttpError(404, "Không có việc này");
  if (!statuses.includes(job.status)) throw new HttpError(409, job.status === "cancelled" ? "Việc đã bị hủy trên app" : "Việc đã kết thúc");
  return job;
}
const channelUid = (channelId: number) => get<{ zalo_uid: string | null; name: string }>("SELECT zalo_uid, name FROM channels WHERE id = ?", channelId);

/** Máy báo còn sống (mỗi ~10 giây) và hỏi việc đang chờ. */
pcAgentRouter.post(
  "/hello",
  wrap((req, res) => {
    expireStale();
    const uid = /^\d{6,25}$/.test(String(req.body?.uid ?? "")) ? String(req.body.uid) : null;
    run(
      "UPDATE pc_sync_agents SET last_seen_at = ?, last_uid = COALESCE(?, last_uid), host = ?, version = ? WHERE id = ?",
      Date.now(),
      uid,
      String(req.body?.host ?? "").slice(0, 60) || null,
      String(req.body?.version ?? "").slice(0, 20) || null,
      req.agent!.id,
    );
    const jobs = all<{ id: number; channel_id: number; days: number; name: string; zalo_uid: string; declines: string | null }>(
      `SELECT j.id, j.channel_id, j.days, c.name, c.zalo_uid, j.declines FROM pc_sync_jobs j JOIN channels c ON c.id = j.channel_id
       WHERE j.status = 'pending' AND c.zalo_uid IS NOT NULL ORDER BY j.id`,
    ).map((j) => ({
      id: j.id,
      channel: j.name,
      zalo_uid: j.zalo_uid,
      days: j.days,
      declined: (parse(j.declines) ?? []).some((d: any) => d.agent_id === req.agent!.id && d.uid === uid),
    }));
    res.json({ agent: req.agent!.name, jobs });
  }),
);

/** Nhận việc: tài khoản Zalo PC phải trùng tài khoản của kênh. */
pcAgentRouter.post(
  "/jobs/:id/claim",
  wrap((req, res) => {
    const job = get<Job>("SELECT * FROM pc_sync_jobs WHERE id = ? AND status = 'pending'", Number(req.params.id));
    if (!job) throw new HttpError(409, "Việc không còn chờ (máy khác đã nhận hoặc đã hủy)");
    const ch = channelUid(job.channel_id);
    if (!ch?.zalo_uid || String(req.body?.uid) !== ch.zalo_uid) throw new HttpError(400, "Zalo PC trên máy này không cùng tài khoản với kênh");
    const r = run("UPDATE pc_sync_jobs SET status = 'running', agent_id = ?, started_at = ?, heartbeat_at = ? WHERE id = ? AND status = 'pending'", req.agent!.id, Date.now(), Date.now(), job.id);
    if (!r.changes) throw new HttpError(409, "Máy khác vừa nhận việc này");
    res.json({ id: job.id, channel_id: job.channel_id, channel: ch.name, days: job.days });
  }),
);

/** Máy kiểm thấy Zalo PC đang đăng nhập tài khoản khác: ghi lại để app báo cho người bấm. */
pcAgentRouter.post(
  "/jobs/:id/decline",
  wrap((req, res) => {
    const job = get<Job>("SELECT * FROM pc_sync_jobs WHERE id = ? AND status = 'pending'", Number(req.params.id));
    if (!job) return res.json({ ok: true });
    const list = ((parse(job.declines) ?? []) as any[]).filter((d) => d.agent_id !== req.agent!.id);
    list.push({ agent_id: req.agent!.id, agent: req.agent!.name, uid: String(req.body?.uid ?? "").slice(0, 25), reason: String(req.body?.reason ?? "").slice(0, 200), at: Date.now() });
    run("UPDATE pc_sync_jobs SET declines = ? WHERE id = ?", JSON.stringify(list.slice(-10)), job.id);
    res.json({ ok: true });
  }),
);

/** Tiến độ (cũng là nhịp sống). Trả về status để máy dừng nếu việc bị hủy trên app. */
pcAgentRouter.post(
  "/jobs/:id/progress",
  wrap((req, res) => {
    const job = get<Job>("SELECT * FROM pc_sync_jobs WHERE id = ?", Number(req.params.id));
    if (!job || job.agent_id !== req.agent!.id) throw new HttpError(404, "Không có việc này");
    if (job.status === "running") {
      const prev = parse(job.progress) ?? {};
      const b = req.body ?? {};
      const num = (v: unknown) => Math.max(0, Math.min(1e9, Math.round(Number(v)) || 0));
      const next = { ...prev, convsDone: num(b.convsDone), convsTotal: num(b.convsTotal), read: num(b.read), step: String(b.step ?? "").slice(0, 100) };
      run("UPDATE pc_sync_jobs SET progress = ?, heartbeat_at = ? WHERE id = ?", JSON.stringify(next), Date.now(), job.id);
    }
    res.json({ status: job.status });
  }),
);

/** Một lô tin của việc đang chạy. */
pcAgentRouter.post(
  "/jobs/:id/import",
  wrap((req, res) => {
    const job = agentJob(req, ["running"]);
    const r = importHistory(job.channel_id, req.body, job.requested_by ?? 0);
    const prev = parse(job.progress) ?? {};
    const next = { ...prev, added: (prev.added ?? 0) + r.added, skipped: (prev.skipped ?? 0) + r.skipped, conversations: (prev.conversations ?? 0) + r.conversations };
    run("UPDATE pc_sync_jobs SET progress = ?, heartbeat_at = ? WHERE id = ?", JSON.stringify(next), Date.now(), job.id);
    res.json(r);
  }),
);

pcAgentRouter.post(
  "/jobs/:id/finish",
  wrap((req, res) => {
    const job = agentJob(req, ["running", "cancelled"]);
    if (job.status === "cancelled") return res.json({ ok: true });
    const ok = !!req.body?.ok;
    run(
      "UPDATE pc_sync_jobs SET status = ?, error = ?, finished_at = ?, heartbeat_at = ? WHERE id = ?",
      ok ? "done" : "error",
      ok ? null : String(req.body?.error ?? "Lỗi không rõ").slice(0, 300),
      Date.now(),
      Date.now(),
      job.id,
    );
    const p = parse(job.progress) ?? {};
    console.info(
      `[pc-sync] Kênh #${job.channel_id}: máy "${req.agent!.name}" ${ok ? "đồng bộ xong" : `dừng do lỗi (${req.body?.error ?? ""})`} — nhập mới ${p.added ?? 0} tin vào ${p.conversations ?? 0} lượt hội thoại, đọc ${p.read ?? 0} tin`,
    );
    res.json({ ok: true });
  }),
);
