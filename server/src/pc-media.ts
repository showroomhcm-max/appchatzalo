/**
 * Ảnh / video Zalo PC còn giữ trên máy đồng bộ.
 *
 * Link ảnh trong tin nhập từ Zalo PC đa số đã hết hạn trên máy chủ Zalo, nhưng Zalo PC giữ bản đã tải về ở
 * %APPDATA%\ZaloData\media\<tài khoản>\ZaloDownloads\resource\<hội thoại>\{picture,video,Cache}\
 * với tên tệp "<giờ gửi ms>_<người gửi>_<hội thoại>[_<md5 link ảnh>][.đuôi]".
 * - Bước 1: chương trình đồng bộ gửi danh sách tên tệp; ở đây ghép với tin trong app (md5 link, rồi giờ gửi).
 * - Bước 2: máy hỏi tệp nào cần (tin chưa có bản trên NAS, còn trong hạn giữ), gửi từng tệp lên; ảnh .jxl đổi sang .jpg.
 *   Bản tải lên theo cùng quy tắc giữ / tự xóa của "Lưu ảnh / video lên NAS" (media-store.ts).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { all, db, get, run, tx } from "./db.js";
import { bus } from "./bus.js";
import { config } from "./config.js";
import { HttpError } from "./conversations.js";
import { isJxl, jxlReady, jxlToJpeg } from "./jxl.js";
import { mediaStoreConfig } from "./media-store.js";
import { conversationKey, getConversation, getMessage } from "./store.js";

db.exec(`
CREATE TABLE IF NOT EXISTS pc_media_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id INTEGER NOT NULL,
  agent_id INTEGER NOT NULL,
  rel_path TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  from_uid TEXT,
  kind TEXT NOT NULL,
  size INTEGER,
  message_id INTEGER,
  exact INTEGER NOT NULL DEFAULT 0,
  md5_hit INTEGER NOT NULL DEFAULT 0,
  seen_at INTEGER NOT NULL,
  UNIQUE(channel_id, rel_path)
);
CREATE INDEX IF NOT EXISTS idx_pc_media_msg ON pc_media_files(message_id);
`);
// Bước 2: trạng thái tải lên NAS của từng tệp (NULL = chưa, 'done', 'skip: …', 'fail: …')
if (!all<{ name: string }>("PRAGMA table_info(pc_media_files)").some((c) => c.name === "upload_status")) {
  db.exec("ALTER TABLE pc_media_files ADD COLUMN upload_status TEXT");
  db.exec("ALTER TABLE pc_media_files ADD COLUMN upload_at INTEGER");
}

const NAME = /^(g?\d{3,25})\/(picture|video|Cache)\/(\d{12,14})_(\d{1,25})_(g?\d{3,25})(?:_([0-9a-f]{32}|[a-z]))?(\.[a-z0-9]{2,5})?$/i;
const URL_FIELDS = ["href", "hdUrl", "oriUrl", "normalUrl", "thumb", "thumbUrl"];
const md5 = (s: string) => crypto.createHash("md5").update(s).digest("hex");

type Parsed = { rel: string; thread: string; ts: number; from: string; kind: string; tag: string; size: number };

function parse(f: any): Parsed | null {
  const rel = String(f?.p ?? "").replace(/\\/g, "/");
  const m = NAME.exec(rel);
  if (!m) return null;
  const folder = m[2].toLowerCase();
  const tag = (m[6] ?? "").toLowerCase();
  // picture = ảnh (.jxl); video = video (.mp4, không đuôi); Cache_n = ảnh .jpg, Cache_t = video
  const kind = folder === "picture" ? "photo" : folder === "video" ? "video" : tag === "n" ? "photo" : tag === "t" ? "video" : "other";
  return { rel, thread: m[5].replace(/^g/, ""), ts: Number(m[3]), from: m[4], kind, tag, size: Math.max(0, Math.round(Number(f?.s) || 0)) };
}

type Cand = { id: number; ts: number; sender_uid: string | null; msg_type: string; md5s: Set<string> };

/** Tin ảnh / video của một hội thoại kèm mã md5 các link (tên tệp Zalo PC chứa md5 của link ảnh). */
function threadCandidates(channelId: number, thread: string): Cand[] {
  return all<{ id: number; ts: number; sender_uid: string | null; msg_type: string; raw: string | null }>(
    `SELECT id, ts, sender_uid, msg_type, raw FROM messages
     WHERE conversation_id = ? AND msg_type IN ('chat.photo', 'chat.gif', 'chat.video.msg') AND undone = 0`,
    conversationKey(channelId, thread),
  ).map((r) => {
    const md5s = new Set<string>();
    try {
      const raw = r.raw ? JSON.parse(r.raw) : {};
      for (const k of URL_FIELDS) {
        const u = raw[k];
        if (typeof u === "string" && u) {
          md5s.add(md5(u));
          md5s.add(md5(u.split("?")[0]));
        }
      }
    } catch {}
    return { id: r.id, ts: r.ts, sender_uid: r.sender_uid, msg_type: r.msg_type, md5s };
  });
}

/**
 * Ghép một tệp với tin trong app: trước hết theo mã md5 trong tên tệp (cả hội thoại, không giới hạn giờ);
 * không có thì theo giờ gửi lệch ≤ 2 giây, cùng loại, ưu tiên cùng người gửi / đúng giờ.
 */
function match(cands: Cand[], f: Parsed) {
  if (f.tag.length === 32) {
    const hit = cands.find((c) => c.md5s.has(f.tag));
    if (hit) return { id: hit.id, exact: hit.ts === f.ts, hit: true };
  }
  const types = f.kind === "video" ? ["chat.video.msg"] : ["chat.photo", "chat.gif"];
  const near = cands
    .filter((c) => types.includes(c.msg_type) && Math.abs(c.ts - f.ts) <= 2000)
    .sort(
      (a, b) =>
        Number(b.ts === f.ts) - Number(a.ts === f.ts) ||
        Number(!!b.sender_uid && b.sender_uid === f.from) - Number(!!a.sender_uid && a.sender_uid === f.from) ||
        Math.abs(a.ts - f.ts) - Math.abs(b.ts - f.ts),
    );
  return near[0] ? { id: near[0].id, exact: near[0].ts === f.ts, hit: false } : null;
}

/** Giờ bắt đầu lần quét đang nhận (theo máy + kênh): lô cuối xóa tệp không còn trên máy. */
const scanStart = new Map<string, number>();

/** Một lô danh sách tệp từ máy đồng bộ (first / last = lô đầu / cuối của một lần quét). Giữ trạng thái đã tải lên của tệp cũ. */
export function receiveManifest(agentId: number, agentName: string, body: any) {
  const uid = /^\d{6,25}$/.test(String(body?.uid ?? "")) ? String(body.uid) : null;
  const ch = uid ? get<{ id: number; name: string }>("SELECT id, name FROM channels WHERE platform = 'zalo' AND zalo_uid = ? AND deleted_at IS NULL", uid) : undefined;
  if (!ch) return { ignored: true };
  const files = (Array.isArray(body?.files) ? body.files : []).slice(0, 5000);
  const now = Date.now();
  const key = `${agentId}:${ch.id}`;
  if (body?.first || !scanStart.has(key)) scanStart.set(key, now);
  let parsed = 0;
  let matched = 0;
  const byThread = new Map<string, Parsed[]>();
  for (const raw of files) {
    const f = parse(raw);
    if (!f || f.kind === "other") continue;
    parsed++;
    byThread.set(f.thread, [...(byThread.get(f.thread) ?? []), f]);
  }
  tx(() => {
    for (const [thread, list] of byThread) {
      const cands = threadCandidates(ch.id, thread);
      for (const f of list) {
        const m = cands.length ? match(cands, f) : null;
        if (m) matched++;
        run(
          `INSERT INTO pc_media_files(channel_id, agent_id, rel_path, thread_id, ts, from_uid, kind, size, message_id, exact, md5_hit, seen_at)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(channel_id, rel_path) DO UPDATE SET agent_id = excluded.agent_id, size = excluded.size, message_id = excluded.message_id,
           exact = excluded.exact, md5_hit = excluded.md5_hit, seen_at = excluded.seen_at`,
        ch.id,
        agentId,
        f.rel,
        f.thread,
        f.ts,
        f.from,
        f.kind,
        f.size,
        m?.id ?? null,
        m?.exact ? 1 : 0,
        m?.hit ? 1 : 0,
        now,
      );
      }
    }
    // Lô cuối: tệp không còn trên máy (Zalo PC đã dọn) thì bỏ khỏi danh sách
    if (body?.last) run("DELETE FROM pc_media_files WHERE channel_id = ? AND agent_id = ? AND seen_at < ?", ch.id, agentId, scanStart.get(key)!);
  });
  if (body?.last) {
    scanStart.delete(key);
    logSummary(ch.id, ch.name, agentId, agentName);
  }
  return { ok: true, parsed, matched };
}

// ───────────── Bước 2: máy đồng bộ tải ảnh / video đã ghép lên NAS ─────────────

const URL_LOCAL = /^\/uploads\//;
const fileStats = new Map<number, { ok: number; photos: number; videos: number; bytes: number; failed: number; since: number }>();

/**
 * Tệp máy nên tải lên: đã ghép với tin còn trong hạn giữ (Cài đặt › Lưu ảnh / video lên NAS), tin chưa có bản trên NAS,
 * chưa tải / chưa lỗi. Mỗi tin một tệp: ảnh ưu tiên bản .jpg trong Cache (khỏi đổi định dạng), rồi bản .jxl.
 */
export function wantedFiles(agentId: number, body: any) {
  const cfg = mediaStoreConfig();
  if (!cfg.enabled) return { files: [], reason: "Đang tắt lưu ảnh / video lên NAS" };
  const uid = /^\d{6,25}$/.test(String(body?.uid ?? "")) ? String(body.uid) : null;
  const ch = uid ? get<{ id: number }>("SELECT id FROM channels WHERE platform = 'zalo' AND zalo_uid = ? AND deleted_at IS NULL", uid) : undefined;
  if (!ch) return { files: [], ignored: true };
  const cutoff = cfg.keepDays > 0 ? Date.now() - cfg.keepDays * 86_400_000 : 0;
  const rows = all<{ message_id: number; rel_path: string; kind: string }>(
    `SELECT f.message_id, f.rel_path, f.kind FROM pc_media_files f JOIN messages m ON m.id = f.message_id
     WHERE f.channel_id = ? AND f.agent_id = ? AND f.upload_status IS NULL AND m.undone = 0 AND m.ts >= ?
       AND (m.raw IS NULL OR json_extract(m.raw, '$._local') IS NULL)
     ORDER BY m.ts DESC, f.message_id, (f.rel_path LIKE '%/Cache/%') DESC
     LIMIT 600`,
    ch.id,
    agentId,
    cutoff,
  );
  const seen = new Set<number>();
  const files: { p: string; kind: string }[] = [];
  for (const r of rows) {
    if (seen.has(r.message_id)) continue;
    seen.add(r.message_id);
    files.push({ p: r.rel_path, kind: r.kind });
    if (files.length >= 100) break;
  }
  return { files };
}

const ext = (b: Buffer) =>
  b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff
    ? ".jpg"
    : b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      ? ".png"
      : b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP"
        ? ".webp"
        : b.subarray(4, 8).toString("latin1") === "ftyp"
          ? ".mp4"
          : null;

/** Máy gửi một tệp (nội dung thô). Ảnh .jxl đổi sang .jpg; lưu vào uploads/media/<tháng>/ và gắn vào tin. */
export async function receiveUpload(agentId: number, agentName: string, uid: string, relPath: string, body: Buffer, missing = false) {
  const ch = /^\d{6,25}$/.test(uid) ? get<{ id: number; name: string }>("SELECT id, name FROM channels WHERE platform = 'zalo' AND zalo_uid = ? AND deleted_at IS NULL", uid) : undefined;
  if (!ch) throw new HttpError(404, "Không có kênh của tài khoản Zalo này");
  const row = get<{ id: number; message_id: number | null; kind: string; upload_status: string | null }>(
    "SELECT id, message_id, kind, upload_status FROM pc_media_files WHERE channel_id = ? AND agent_id = ? AND rel_path = ?",
    ch.id,
    agentId,
    relPath,
  );
  if (!row?.message_id) throw new HttpError(404, "Tệp không có trong danh sách cần tải");
  const msg = get<{ id: number; ts: number; raw: string | null; conversation_id: string }>("SELECT id, ts, raw, conversation_id FROM messages WHERE id = ?", row.message_id);
  if (!msg) throw new HttpError(404, "Tin nhắn không còn");
  const mark = (status: string) => run("UPDATE pc_media_files SET upload_status = ?, upload_at = ? WHERE id = ?", status, Date.now(), row.id);
  const st = fileStats.get(agentId) ?? { ok: 0, photos: 0, videos: 0, bytes: 0, failed: 0, since: Date.now() };
  fileStats.set(agentId, st);
  const fail = (reason: string) => {
    mark(`fail: ${reason}`.slice(0, 200));
    st.failed++;
    return { ok: false, reason };
  };
  if (missing) return fail("tệp không còn trên máy (Zalo PC đã dọn)");
  let raw: Record<string, any> = {};
  try {
    raw = msg.raw ? JSON.parse(msg.raw) : {};
  } catch {}
  if (typeof raw._local === "string" && URL_LOCAL.test(raw._local)) {
    mark("skip: đã có bản trên NAS");
    return { ok: true, skipped: true };
  }
  let data = body;
  let e = ext(body);
  if (row.kind === "photo") {
    if (isJxl(body)) {
      // Bộ giải mã chưa nạp được là lỗi máy chủ: báo 503 để máy gửi lại sau, không đánh dấu tệp hỏng
      try {
        await jxlReady();
      } catch (err: any) {
        console.warn("[pc-media] Không nạp được bộ giải mã JPEG XL:", err?.message ?? err);
        throw new HttpError(503, "Máy chủ chưa đổi được ảnh .jxl, thử lại sau");
      }
      try {
        data = await jxlToJpeg(body);
        e = ".jpg";
      } catch (err: any) {
        return fail(`không đổi được ảnh .jxl (${err?.message ?? err})`);
      }
    } else if (e !== ".jpg" && e !== ".png" && e !== ".webp") return fail("không phải ảnh");
  } else if (e !== ".mp4") return fail("không phải video mp4");
  const month = new Date(msg.ts || Date.now()).toISOString().slice(0, 7);
  const dir = path.join(config.uploadDir, "media", month);
  fs.mkdirSync(dir, { recursive: true });
  const name = `${crypto.randomBytes(12).toString("hex")}${e}`;
  fs.writeFileSync(path.join(dir, name), data);
  run(
    "UPDATE messages SET raw = json_remove(json_set(COALESCE(raw, '{}'), '$._local', ?, '$._local_size', ?, '$._local_src', 'zalo-pc'), '$._local_fail', '$._local_try', '$._local_tries') WHERE id = ?",
    `/uploads/media/${month}/${name}`,
    data.length,
    msg.id,
  );
  // Tin đã có bản: các tệp khác của cùng tin (bản .jxl / bản Cache) khỏi tải
  run("UPDATE pc_media_files SET upload_status = 'done', upload_at = ? WHERE message_id = ? AND channel_id = ?", Date.now(), msg.id, ch.id);
  st.ok++;
  st.bytes += data.length;
  if (row.kind === "photo") st.photos++;
  else st.videos++;
  if (st.ok % 500 === 0) logUploads(agentId, agentName, ch.name);
  const message = getMessage(msg.id);
  const conversation = getConversation(msg.conversation_id);
  if (message && conversation) bus.emit("message.updated", message, conversation);
  return { ok: true };
}

/** Ghi nhật ký tiến độ tải lên (mỗi 500 tệp, và khi máy báo hết tệp cần tải). */
export function logUploads(agentId: number, agentName: string, channelName?: string) {
  const st = fileStats.get(agentId);
  if (!st || (!st.ok && !st.failed)) return;
  const keep = mediaStoreConfig().keepDays;
  const left = get<{ n: number }>(
    `SELECT COUNT(DISTINCT f.message_id) AS n FROM pc_media_files f JOIN messages m ON m.id = f.message_id
     WHERE f.agent_id = ? AND f.upload_status IS NULL AND m.undone = 0 AND m.ts >= ?
       AND (m.raw IS NULL OR json_extract(m.raw, '$._local') IS NULL)`,
    agentId,
    keep > 0 ? Date.now() - keep * 86_400_000 : 0,
  )?.n ?? 0;
  console.info(
    `[pc-media] Máy "${agentName}"${channelName ? ` (kênh "${channelName}")` : ""}: đã đưa lên NAS ${st.ok} tệp từ Zalo PC (${st.photos} ảnh, ${st.videos} video, ${(st.bytes / 1024 ** 2).toFixed(0)} MB), lỗi ${st.failed}, còn ${left} tin chờ tải`,
  );
}

export function finishUploads(agentId: number, agentName: string) {
  logUploads(agentId, agentName);
  fileStats.delete(agentId);
}

/** Tóm tắt cho một kênh (+ máy): số tệp, số tin ghép được, số tin đang không có bản trên NAS (cứu được). */
export function mediaSummary(channelId: number, agentId?: number) {
  const where = agentId ? "f.channel_id = ? AND f.agent_id = ?" : "f.channel_id = ?";
  const args = agentId ? [channelId, agentId] : [channelId];
  const s = get<{ files: number; photos: number; videos: number; bytes: number | null; matched: number; exact: number; md5: number; rescue: number; history: number; uploaded: number; oldest: number | null }>(
    `SELECT COUNT(*) AS files,
       SUM(f.kind = 'photo') AS photos, SUM(f.kind = 'video') AS videos, SUM(f.size) AS bytes,
       COUNT(DISTINCT f.message_id) AS matched,
       COUNT(DISTINCT CASE WHEN f.exact = 1 THEN f.message_id END) AS exact,
       COUNT(DISTINCT CASE WHEN f.md5_hit = 1 THEN f.message_id END) AS md5,
       COUNT(DISTINCT CASE WHEN json_extract(m.raw, '$._local') IS NULL THEN f.message_id END) AS rescue,
       COUNT(DISTINCT CASE WHEN m.source = 'history' THEN f.message_id END) AS history,
       COUNT(DISTINCT CASE WHEN f.upload_status = 'done' THEN f.message_id END) AS uploaded,
       MIN(CASE WHEN f.message_id IS NOT NULL THEN m.ts END) AS oldest
     FROM pc_media_files f LEFT JOIN messages m ON m.id = f.message_id WHERE ${where}`,
    ...args,
  );
  // Tin ảnh / video của kênh chưa có bản trên NAS: để so tỷ lệ cứu được
  const missing = get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM messages WHERE conversation_id LIKE ? ESCAPE '\\' AND msg_type IN ('chat.photo', 'chat.video.msg', 'chat.gif')
       AND undone = 0 AND raw IS NOT NULL AND json_extract(raw, '$._local') IS NULL`,
    `${channelId}\\_%`,
  );
  return {
    files: s?.files ?? 0,
    photos: s?.photos ?? 0,
    videos: s?.videos ?? 0,
    bytes: s?.bytes ?? 0,
    matched: s?.matched ?? 0,
    exact: s?.exact ?? 0,
    md5: s?.md5 ?? 0,
    rescue: s?.rescue ?? 0,
    history: s?.history ?? 0,
    uploaded: s?.uploaded ?? 0,
    oldest: s?.oldest ?? null,
    missing: missing?.n ?? 0,
  };
}

function logSummary(channelId: number, channelName: string, agentId: number, agentName: string) {
  const s = mediaSummary(channelId, agentId);
  const gb = ((s.bytes ?? 0) / 1024 ** 3).toFixed(2);
  console.info(
    `[pc-media] Kênh "${channelName}", máy "${agentName}": Zalo PC còn giữ ${s.files} tệp (${s.photos} ảnh, ${s.videos} video, ${gb} GB) | ` +
      `ghép được ${s.matched} tin (đúng giờ ${s.exact}, khớp mã tệp ${s.md5}, tin nhập từ Zalo PC ${s.history}` +
      (s.oldest ? `, cũ nhất ${new Date(s.oldest).toLocaleDateString("vi-VN")}` : "") +
      `) | cứu được ${s.rescue} / ${s.missing} tin ảnh/video đang chưa có bản trên NAS`,
  );
}

/** Tóm tắt theo máy cho danh sách máy đồng bộ (Cài đặt). */
export function agentMediaSummaries() {
  const rows = all<{ agent_id: number; channel_id: number; seen: number }>(
    "SELECT agent_id, channel_id, MAX(seen_at) AS seen FROM pc_media_files GROUP BY agent_id, channel_id",
  );
  const out = new Map<number, { files: number; matched: number; rescue: number; uploaded: number; scanned_at: number }>();
  for (const r of rows) {
    const s = mediaSummary(r.channel_id, r.agent_id);
    const prev = out.get(r.agent_id);
    out.set(r.agent_id, {
      files: (prev?.files ?? 0) + s.files,
      matched: (prev?.matched ?? 0) + s.matched,
      rescue: (prev?.rescue ?? 0) + s.rescue,
      uploaded: (prev?.uploaded ?? 0) + s.uploaded,
      scanned_at: Math.max(prev?.scanned_at ?? 0, r.seen),
    });
  }
  return out;
}
