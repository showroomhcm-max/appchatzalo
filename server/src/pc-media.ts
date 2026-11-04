/**
 * Ảnh / video Zalo PC còn giữ trên máy đồng bộ (bước 1: chỉ đếm, chưa tải lên).
 *
 * Link ảnh trong tin nhập từ Zalo PC đa số đã hết hạn trên máy chủ Zalo, nhưng Zalo PC giữ bản đã tải về ở
 * %APPDATA%\ZaloData\media\<tài khoản>\ZaloDownloads\resource\<hội thoại>\{picture,video,Cache}\
 * với tên tệp "<giờ gửi ms>_<người gửi>_<hội thoại>[_<mã>][.đuôi]". Chương trình đồng bộ gửi danh sách tên tệp
 * (không gửi nội dung); ở đây ghép với tin trong app theo hội thoại + giờ gửi để biết cứu được bao nhiêu ảnh.
 */
import crypto from "node:crypto";
import { all, db, get, run, tx } from "./db.js";
import { conversationKey } from "./store.js";

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

type Cand = { id: number; ts: number; sender_uid: string | null; msg_type: string; raw: string | null };

/** Ghép một tệp với tin trong app: cùng hội thoại, giờ gửi lệch ≤ 2 giây, cùng loại; ưu tiên khớp mã tệp / người gửi / đúng giờ. */
function match(channelId: number, f: Parsed) {
  const types = f.kind === "video" ? ["chat.video.msg"] : ["chat.photo", "chat.gif"];
  const cands = all<Cand>(
    `SELECT id, ts, sender_uid, msg_type, raw FROM messages
     WHERE conversation_id = ? AND ts BETWEEN ? AND ? AND msg_type IN (${types.map(() => "?").join(",")}) AND undone = 0`,
    conversationKey(channelId, f.thread),
    f.ts - 2000,
    f.ts + 2000,
    ...types,
  );
  if (!cands.length) return null;
  const score = (c: Cand) => {
    let raw: Record<string, any> = {};
    try {
      raw = c.raw ? JSON.parse(c.raw) : {};
    } catch {}
    const hit =
      f.tag.length === 32 &&
      URL_FIELDS.some((k) => typeof raw[k] === "string" && raw[k] && (md5(raw[k]) === f.tag || md5(raw[k].split("?")[0]) === f.tag));
    return { c, hit, exact: c.ts === f.ts, sameFrom: !!c.sender_uid && c.sender_uid === f.from };
  };
  const scored = cands.map(score).sort(
    (a, b) => Number(b.hit) - Number(a.hit) || Number(b.exact) - Number(a.exact) || Number(b.sameFrom) - Number(a.sameFrom) || Math.abs(a.c.ts - f.ts) - Math.abs(b.c.ts - f.ts),
  );
  const best = scored[0];
  return { id: best.c.id, exact: best.exact, hit: best.hit };
}

/** Một lô danh sách tệp từ máy đồng bộ. first = lô đầu của lần quét (xóa danh sách cũ của máy cho kênh này). */
export function receiveManifest(agentId: number, agentName: string, body: any) {
  const uid = /^\d{6,25}$/.test(String(body?.uid ?? "")) ? String(body.uid) : null;
  const ch = uid ? get<{ id: number; name: string }>("SELECT id, name FROM channels WHERE platform = 'zalo' AND zalo_uid = ? AND deleted_at IS NULL", uid) : undefined;
  if (!ch) return { ignored: true };
  const files = (Array.isArray(body?.files) ? body.files : []).slice(0, 5000);
  const now = Date.now();
  let parsed = 0;
  let matched = 0;
  tx(() => {
    if (body?.first) run("DELETE FROM pc_media_files WHERE channel_id = ? AND agent_id = ?", ch.id, agentId);
    for (const raw of files) {
      const f = parse(raw);
      if (!f || f.kind === "other") continue;
      parsed++;
      const m = match(ch.id, f);
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
  });
  if (body?.last) logSummary(ch.id, ch.name, agentId, agentName);
  return { ok: true, parsed, matched };
}

/** Tóm tắt cho một kênh (+ máy): số tệp, số tin ghép được, số tin đang không có bản trên NAS (cứu được). */
export function mediaSummary(channelId: number, agentId?: number) {
  const where = agentId ? "f.channel_id = ? AND f.agent_id = ?" : "f.channel_id = ?";
  const args = agentId ? [channelId, agentId] : [channelId];
  const s = get<{ files: number; photos: number; videos: number; bytes: number | null; matched: number; exact: number; md5: number; rescue: number; history: number; oldest: number | null }>(
    `SELECT COUNT(*) AS files,
       SUM(f.kind = 'photo') AS photos, SUM(f.kind = 'video') AS videos, SUM(f.size) AS bytes,
       COUNT(DISTINCT f.message_id) AS matched,
       COUNT(DISTINCT CASE WHEN f.exact = 1 THEN f.message_id END) AS exact,
       COUNT(DISTINCT CASE WHEN f.md5_hit = 1 THEN f.message_id END) AS md5,
       COUNT(DISTINCT CASE WHEN json_extract(m.raw, '$._local') IS NULL THEN f.message_id END) AS rescue,
       COUNT(DISTINCT CASE WHEN m.source = 'history' THEN f.message_id END) AS history,
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
  const out = new Map<number, { files: number; matched: number; rescue: number; scanned_at: number }>();
  for (const r of rows) {
    const s = mediaSummary(r.channel_id, r.agent_id);
    const prev = out.get(r.agent_id);
    out.set(r.agent_id, {
      files: (prev?.files ?? 0) + s.files,
      matched: (prev?.matched ?? 0) + s.matched,
      rescue: (prev?.rescue ?? 0) + s.rescue,
      scanned_at: Math.max(prev?.scanned_at ?? 0, r.seen),
    });
  }
  return out;
}
