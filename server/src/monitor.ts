/**
 * Giám sát Zalo nhân viên.
 * Công ty cấp SIM → nhân viên tạo Zalo trên số đó và tự chat với khách bằng điện thoại.
 * Quản lý quét QR gắn Zalo đó vào app ở chế độ "giám sát" (channels.mode = 'monitor'):
 * - App lưu toàn bộ tin hai chiều (kể cả tin nhân viên đã thu hồi, có giờ thu hồi).
 * - Gắn cờ tin có dấu hiệu cần chú ý (chuyển khoản riêng, số tài khoản, kéo khách sang Zalo / SĐT khác, từ khóa tự đặt).
 * - Mất kết nối = mất giám sát (nhân viên đăng xuất phiên web trên điện thoại) → báo trên trang giám sát.
 * - Hội thoại giám sát không lẫn vào hộp thư CSKH chung; chỉ người có quyền "Giám sát" (và chính nhân viên giữ máy) xem được.
 * - Mỗi lần quản lý mở xem hội thoại được ghi nhật ký.
 */
import { all, get, getSetting, logEvent, run, setSetting, tx } from "./db.js";
import { bus } from "./bus.js";
import { fold } from "./text.js";
import { zalo } from "./zalo.js";
import { handover } from "./company-accounts.js";

export type MonitorConfig = {
  /** Gắn cờ khi nhân viên gửi số tài khoản ngân hàng / ví */
  bank: boolean;
  /** Gắn cờ khi nhân viên gửi số điện thoại khác số công ty cấp */
  otherPhone: boolean;
  /** Từ khóa tự đặt (không phân biệt dấu, hoa thường) */
  keywords: string[];
  /** Tin của khách cũng được kiểm tra từ khóa */
  checkCustomer: boolean;
};

const DEFAULT_KEYWORDS = ["chuyển khoản cho em", "ck cho em", "stk", "số tài khoản", "momo", "zalo riêng", "sđt riêng", "inbox riêng", "bên em ngoài", "giá riêng", "không qua công ty", "shop khác"];

export function monitorConfig(): MonitorConfig {
  const c = getSetting<Partial<MonitorConfig>>("monitor.config") ?? {};
  return { bank: c.bank ?? true, otherPhone: c.otherPhone ?? true, keywords: c.keywords ?? DEFAULT_KEYWORDS, checkCustomer: c.checkCustomer ?? false };
}

export function saveMonitorConfig(input: any, userId: number) {
  const cur = monitorConfig();
  const next: MonitorConfig = {
    bank: input?.bank !== undefined ? !!input.bank : cur.bank,
    otherPhone: input?.otherPhone !== undefined ? !!input.otherPhone : cur.otherPhone,
    checkCustomer: input?.checkCustomer !== undefined ? !!input.checkCustomer : cur.checkCustomer,
    keywords: Array.isArray(input?.keywords)
      ? ([...new Set(input.keywords.map((k: unknown) => String(k).trim()).filter((k: string) => k.length >= 2 && k.length <= 60))].slice(0, 100) as string[])
      : cur.keywords,
  };
  setSetting("monitor.config", next);
  logEvent(null, userId, "monitor.config", { keywords: next.keywords.length });
  return next;
}

export const isMonitorChannel = (channelId: number) => get<{ mode: string }>("SELECT mode FROM channels WHERE id = ?", channelId)?.mode === "monitor";

/** Lý do gắn cờ một tin (rỗng = bình thường). */
export function flagReasons(text: string, direction: "in" | "out", ownPhone: string | null, cfg = monitorConfig()) {
  const reasons: string[] = [];
  if (direction === "in" && !cfg.checkCustomer) return reasons;
  const t = fold(text);
  const kw = cfg.keywords.find((k) => t.includes(fold(k)));
  if (kw) reasons.push(`Từ khóa "${kw}"`);
  if (direction === "out") {
    const compact = text.replace(/(\d)[\s.\-]+(?=\d)/g, "$1");
    if (cfg.otherPhone) {
      const own = (ownPhone ?? "").replace(/\D/g, "").slice(-9);
      for (const m of compact.matchAll(/(?:\+?84|0)([35789]\d{8})(?!\d)/g)) {
        if (!own || m[1] !== own) {
          reasons.push(`Gửi số điện thoại khác: 0${m[1]}`);
          break;
        }
      }
    }
    // Số tài khoản: có chữ "stk / tk / số tài khoản" kèm số, hoặc dãy 8–16 chữ số không phải số điện thoại
    const noPhones = compact.replace(/(?:\+?84|0)[35789]\d{8}(?!\d)/g, " ");
    if (cfg.bank && (/\b(stk|tk|so tai khoan|tai khoan)\b\D{0,20}\d{6,}/.test(t) || /(?<!\d)\d{8,16}(?!\d)/.test(noPhones))) {
      reasons.push("Có thể là số tài khoản");
    }
  }
  return [...new Set(reasons)];
}

function onMessage(message: any, conversation: any) {
  if (!message?.text) return;
  if (!isMonitorChannel(conversation.channel_id)) return;
  const own = get<{ phone: string | null }>("SELECT phone FROM channel_assets WHERE channel_id = ?", conversation.channel_id)?.phone ?? null;
  const reasons = flagReasons(String(message.text), message.direction, own);
  for (const reason of reasons) {
    const r = run(
      "INSERT OR IGNORE INTO monitor_flags(message_id, conversation_id, channel_id, reason, created_at) VALUES(?, ?, ?, ?, ?)",
      message.id,
      conversation.id,
      conversation.channel_id,
      reason,
      Date.now(),
    );
    if (r.changes) bus.emit("monitor.flagged", { channel_id: conversation.channel_id, conversation_id: conversation.id, reason });
  }
}

const dayStart = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** Tài khoản Zalo nhân viên đang giám sát. */
export function monitorAccounts() {
  const today = dayStart();
  return all<any>(
    `SELECT ch.id AS channel_id, ch.name, ch.zalo_name, ch.avatar, ch.active,
            a.phone, a.holder_id, u.display_name AS holder_name, u.active AS holder_active, COALESCE(a.status, 'stored') AS status,
            (SELECT COUNT(*) FROM monitor_flags f WHERE f.channel_id = ch.id AND f.reviewed_at IS NULL) AS open_flags,
            (SELECT COUNT(*) FROM conversations c WHERE c.channel_id = ch.id) AS conversations,
            (SELECT COUNT(*) FROM conversations c WHERE c.channel_id = ch.id AND c.last_direction = 'in' AND c.status != 'closed') AS waiting,
            (SELECT MAX(last_message_at) FROM conversations c WHERE c.channel_id = ch.id) AS last_message_at
     FROM channels ch
     LEFT JOIN channel_assets a ON a.channel_id = ch.id
     LEFT JOIN users u ON u.id = a.holder_id
     WHERE ch.mode = 'monitor'
     ORDER BY ch.name`,
  ).map((r) => {
    const s = get<any>(
      `SELECT SUM(m.direction = 'in') AS msg_in, SUM(m.direction = 'out') AS msg_out, SUM(m.undone = 1) AS undone,
              COUNT(DISTINCT m.conversation_id) AS customers
       FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE c.channel_id = ? AND m.ts >= ?`,
      r.channel_id,
      today,
    );
    const lastDrop = get<{ ts: number; data: string }>(
      "SELECT ts, data FROM events WHERE type = 'channel.disconnected' AND json_extract(data, '$.channel') = ? ORDER BY ts DESC LIMIT 1",
      r.channel_id,
    );
    const status = r.active ? zalo.session(r.channel_id).getStatus() : null;
    return {
      ...r,
      connection: status,
      monitoring: status?.state === "connected",
      since_drop: status?.state !== "connected" && lastDrop ? lastDrop.ts : null,
      today: { msg_in: s?.msg_in ?? 0, msg_out: s?.msg_out ?? 0, undone: s?.undone ?? 0, customers: s?.customers ?? 0 },
    };
  });
}

/** Tạo tài khoản giám sát: kênh Zalo chế độ giám sát + hồ sơ SIM + giao cho nhân viên, sau đó quét QR. */
export function createMonitorAccount(input: { name: string; phone?: string; holderId?: number | null }, byUserId: number) {
  const holderName = input.holderId ? get<{ display_name: string }>("SELECT display_name FROM users WHERE id = ?", input.holderId)?.display_name : null;
  // Không đặt tên thì lấy "Zalo <tên nhân viên>" hoặc "Zalo <SĐT>"
  const name = input.name.trim() || (holderName ? `Zalo ${holderName}` : input.phone?.trim() ? `Zalo ${input.phone.trim()}` : "");
  if (!name) throw new Error("Nhập SĐT hoặc chọn nhân viên nhận SIM");
  const id = tx(() => {
    const channelId = Number(run("INSERT INTO channels(name, mode, created_at) VALUES(?, 'monitor', ?)", name, Date.now()).lastInsertRowid);
    run("INSERT INTO channel_assets(channel_id, phone, status, updated_at, updated_by) VALUES(?, ?, 'stored', ?, ?)", channelId, input.phone?.trim() || null, Date.now(), byUserId);
    logEvent(null, byUserId, "channel.created", { id: channelId, name, mode: "monitor" });
    return channelId;
  });
  if (input.holderId) handover(id, { toUserId: input.holderId, note: "Cấp SIM, giám sát Zalo nhân viên" }, byUserId);
  bus.emit("settings.changed", "channels");
  return id;
}

/** Đổi chế độ một kênh Zalo có sẵn: CSKH chung ⇄ giám sát. */
export function setChannelMode(channelId: number, mode: "shared" | "monitor", byUserId: number) {
  run("UPDATE channels SET mode = ? WHERE id = ? AND platform = 'zalo'", mode, channelId);
  logEvent(null, byUserId, "channel.mode", { channel: channelId, mode });
  bus.emit("settings.changed", "channels");
}

export function monitorConversations(channelId: number, q?: string) {
  const like = q?.trim() ? `%${fold(q.trim())}%` : null;
  return all<any>(
    `SELECT c.id, c.thread_id, c.type, c.name, c.avatar, c.phone, c.last_message_at, c.last_message_preview, c.last_direction,
            (SELECT COUNT(*) FROM monitor_flags f WHERE f.conversation_id = c.id AND f.reviewed_at IS NULL) AS open_flags,
            (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id AND m.undone = 1) AS undone
     FROM conversations c
     WHERE c.channel_id = ? ${like ? "AND (fold(c.name) LIKE ? OR c.phone LIKE ? OR EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND fold(m.text) LIKE ?))" : ""}
     ORDER BY COALESCE(c.last_message_at, c.created_at) DESC LIMIT 300`,
    channelId,
    ...(like ? [like, `%${q!.trim()}%`, like] : []),
  );
}

export function monitorFlags(channelId?: number, includeReviewed = false) {
  return all<any>(
    `SELECT f.id, f.reason, f.created_at, f.reviewed_at, f.conversation_id, f.channel_id, f.message_id,
            m.text, m.direction, m.ts, m.undone, c.name AS conversation_name, ch.name AS channel_name, ru.display_name AS reviewed_by_name
     FROM monitor_flags f
     JOIN messages m ON m.id = f.message_id
     JOIN conversations c ON c.id = f.conversation_id
     JOIN channels ch ON ch.id = f.channel_id
     LEFT JOIN users ru ON ru.id = f.reviewed_by
     WHERE ${includeReviewed ? "1 = 1" : "f.reviewed_at IS NULL"} ${channelId ? "AND f.channel_id = ?" : ""}
     ORDER BY f.created_at DESC LIMIT 300`,
    ...(channelId ? [channelId] : []),
  );
}

export function reviewFlag(id: number, userId: number) {
  run("UPDATE monitor_flags SET reviewed_at = ?, reviewed_by = ? WHERE id = ? AND reviewed_at IS NULL", Date.now(), userId, id);
}

export function startMonitor() {
  bus.on("message.created", (message, conversation) => {
    try {
      onMessage(message, conversation);
    } catch (e) {
      console.error("[monitor] Kiểm tra tin lỗi:", e);
    }
  });
}
