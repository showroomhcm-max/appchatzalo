/**
 * Chỉ mục tìm kiếm tin nhắn (SQLite FTS5, tách theo từng cụm 3 ký tự): tìm "chứa chữ …" trong hàng trăm nghìn tin
 * mà không phải đọc qua từng tin. Nội dung lưu dạng không dấu, chữ thường (fold) nên gõ có dấu / không dấu đều ra.
 * - Tin mới: ghi vào chỉ mục ngay lúc lưu (store.ts saveMessage).
 * - Tin cũ: lúc khởi động tự bổ sung nền từng lô (không làm app khựng); chưa xong thì tìm theo cách cũ.
 * - Từ khóa dưới 3 ký tự: chỉ mục không dùng được, tìm theo cách cũ.
 */
import { db, get, run, getSetting, setSetting } from "./db.js";
import { fold } from "./text.js";

db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(body, tokenize = 'trigram')");

const PROGRESS_KEY = "search.fts_indexed_upto";
let ready = false;

/** Ghi một tin vào chỉ mục (gọi trong cùng giao dịch lưu tin). */
export function indexMessage(id: number, text: string | null | undefined) {
  const body = fold(text ?? "");
  if (body.length < 3) return;
  run("INSERT INTO messages_fts(rowid, body) VALUES(?, ?)", id, body);
}

/** Chuỗi tìm cho chỉ mục: bỏ ký tự đại diện của LIKE, không dấu; null nếu không dùng chỉ mục được. */
function ftsTerm(q: string) {
  const t = fold(q.trim()).replace(/[%_\\]/g, "");
  return ready && t.length >= 3 ? `%${t}%` : null;
}

/**
 * Điều kiện SQL "tin nhắn m chứa q" — dùng chỉ mục khi được, không thì so khớp từng tin như trước.
 * column: biểu thức id tin nhắn (vd "m.id").
 */
export function messageMatch(q: string, column = "m.id", textColumn = "m.text"): { sql: string; params: string[] } {
  const term = ftsTerm(q);
  if (term) return { sql: `${column} IN (SELECT rowid FROM messages_fts WHERE body LIKE ?)`, params: [term] };
  const like = `%${fold(q.trim()).replace(/[\\%_]/g, (c) => "\\" + c)}%`;
  return { sql: `fold(${textColumn}) LIKE ? ESCAPE '\\'`, params: [like] };
}

/** Bổ sung tin cũ vào chỉ mục, từng lô 2.000 tin, nhường app chạy giữa các lô. */
export function startSearchIndex() {
  const target = get<{ m: number | null }>("SELECT MAX(id) AS m FROM messages")?.m ?? 0;
  let upto = Number(getSetting<number>(PROGRESS_KEY) ?? 0);
  if (upto >= target) {
    ready = true;
    return;
  }
  const started = Date.now();
  const select = db.prepare("SELECT id, text FROM messages WHERE id > ? AND id <= ? ORDER BY id LIMIT 2000");
  const step = () => {
    try {
      const rows = select.all(upto, target) as { id: number; text: string | null }[];
      db.exec("BEGIN");
      try {
        for (const r of rows) {
          // Tin mới lưu trong lúc bổ sung đã có trong chỉ mục: xóa trước cho khỏi trùng
          run("DELETE FROM messages_fts WHERE rowid = ?", r.id);
          indexMessage(r.id, r.text);
        }
        upto = rows.length ? rows[rows.length - 1].id : target;
        setSetting(PROGRESS_KEY, upto);
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
      if (upto >= target || !rows.length) {
        ready = true;
        console.info(`[search] Đã lập chỉ mục tìm kiếm cho tin cũ (đến tin #${upto}) sau ${Math.round((Date.now() - started) / 1000)} giây`);
        return;
      }
      setImmediate(step);
    } catch (e) {
      console.error("[search] Lập chỉ mục tìm kiếm lỗi, tạm tìm theo cách cũ:", e);
    }
  };
  setImmediate(step);
}
