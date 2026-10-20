/**
 * Zalo cá nhân + SĐT công ty cấp cho nhân viên.
 * Mỗi kênh Zalo (quét QR) là tài sản của công ty: có hồ sơ SIM / máy, người đang giữ, lịch sử bàn giao.
 * - Bàn giao: người giữ được vào thẳng kênh; tin gửi từ điện thoại được ghi tên người giữ.
 * - Thu hồi: chuyển khách đang tư vấn sang người mới, gỡ quyền vào kênh, lưu checklist (thu SIM, đổi mật khẩu…).
 * - Nhân viên bị khóa mà còn giữ tài khoản → chuyển "Cần thu hồi".
 * - Ghi lại các lần Zalo mất kết nối (dấu hiệu đăng nhập nơi khác / bị đăng xuất).
 * Khách hàng và lịch sử chat luôn thuộc tài khoản công ty, không mất khi nhân viên nghỉ.
 */
import { all, get, logEvent, run, tx } from "./db.js";
import { bus } from "./bus.js";
import { zalo } from "./zalo.js";

// Bảng channel_assets, channel_holder_history, cột messages.holder_id: tạo trong db.ts (store.ts cũng dùng)

export const ASSET_STATUS = {
  in_use: "Đang cấp cho nhân viên",
  stored: "Trong kho (chưa cấp)",
  revoking: "Cần thu hồi",
  lost: "Mất máy / mất SIM",
  locked: "Tạm khóa",
} as const;
export type AssetStatus = keyof typeof ASSET_STATUS;

export const REVOKE_CHECKLIST = [
  { key: "sim", label: "Đã thu lại SIM và điện thoại" },
  { key: "password", label: "Đã đổi mật khẩu Zalo, đăng xuất Zalo trên máy cũ" },
  { key: "pending", label: "Đã bàn giao khách đang tư vấn, tin chờ trả lời" },
  { key: "contacts", label: "Đã kiểm tra danh bạ, nhóm Zalo (không xóa khách)" },
] as const;

/** Người đang giữ tài khoản (cho tin gửi từ điện thoại). */
export function holderOf(channelId: number) {
  return get<{ holder_id: number | null }>("SELECT holder_id FROM channel_assets WHERE channel_id = ? AND status = 'in_use'", channelId)?.holder_id ?? null;
}

function ensureAsset(channelId: number) {
  run("INSERT OR IGNORE INTO channel_assets(channel_id, updated_at) VALUES(?, ?)", channelId, Date.now());
}

const dayStart = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** Danh sách tài khoản Zalo công ty kèm người giữ, kết nối và số liệu hôm nay. */
export function listAccounts() {
  const today = dayStart();
  const rows = all<any>(
    `SELECT ch.id AS channel_id, ch.name, ch.mode, ch.zalo_uid, ch.zalo_name, ch.avatar, ch.active,
            a.phone, a.sim_serial, a.carrier, a.device, a.holder_id, a.holder_since, COALESCE(a.status, 'stored') AS status, a.note, a.updated_at,
            u.display_name AS holder_name, u.active AS holder_active
     FROM channels ch
     LEFT JOIN channel_assets a ON a.channel_id = ch.id
     LEFT JOIN users u ON u.id = a.holder_id
     WHERE ch.platform = 'zalo' AND ch.deleted_at IS NULL
     ORDER BY ch.id`,
  );
  const stats = new Map(
    all<any>(
      `SELECT c.channel_id,
              SUM(m.direction = 'in') AS msg_in,
              SUM(m.direction = 'out' AND m.source IN ('web', 'api')) AS out_app,
              SUM(m.direction = 'out' AND m.source = 'phone') AS out_phone,
              COUNT(DISTINCT CASE WHEN m.direction = 'in' THEN m.conversation_id END) AS customers
       FROM messages m JOIN conversations c ON c.id = m.conversation_id
       WHERE m.ts >= ? GROUP BY c.channel_id`,
      today,
    ).map((r) => [r.channel_id, r]),
  );
  const waiting = new Map(
    all<{ channel_id: number; n: number }>(
      "SELECT channel_id, COUNT(*) AS n FROM conversations WHERE status != 'closed' AND last_direction = 'in' GROUP BY channel_id",
    ).map((r) => [r.channel_id, r.n]),
  );
  const lastMsg = new Map(
    all<{ channel_id: number; ts: number }>("SELECT channel_id, MAX(last_message_at) AS ts FROM conversations GROUP BY channel_id").map((r) => [r.channel_id, r.ts]),
  );
  return rows.map((r) => {
    const s = stats.get(r.channel_id) ?? {};
    const lastDrop = get<{ ts: number; data: string }>(
      "SELECT ts, data FROM events WHERE type = 'channel.disconnected' AND json_extract(data, '$.channel') = ? ORDER BY ts DESC LIMIT 1",
      r.channel_id,
    );
    return {
      ...r,
      status_label: ASSET_STATUS[r.status as AssetStatus] ?? r.status,
      connection: r.active ? zalo.session(r.channel_id).getStatus() : null,
      today: { msg_in: s.msg_in ?? 0, out_app: s.out_app ?? 0, out_phone: s.out_phone ?? 0, customers: s.customers ?? 0 },
      waiting: waiting.get(r.channel_id) ?? 0,
      last_message_at: lastMsg.get(r.channel_id) ?? null,
      last_disconnect: lastDrop ? { ts: lastDrop.ts, ...JSON.parse(lastDrop.data ?? "{}") } : null,
    };
  });
}

const str = (v: unknown, max = 120) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

/** Sửa hồ sơ SIM / máy, đánh dấu mất máy, tạm khóa. */
export function updateAsset(channelId: number, body: any, byUserId: number) {
  ensureAsset(channelId);
  const cur = get<any>("SELECT * FROM channel_assets WHERE channel_id = ?", channelId)!;
  let status: AssetStatus = cur.status;
  if (body?.status && body.status in ASSET_STATUS && body.status !== "in_use") {
    // "Đang cấp" chỉ đặt qua bàn giao; mất máy / tạm khóa vẫn giữ tên người giữ để truy vết
    status = body.status;
  }
  run(
    `UPDATE channel_assets SET phone = ?, sim_serial = ?, carrier = ?, device = ?, note = ?, status = ?, updated_at = ?, updated_by = ? WHERE channel_id = ?`,
    body?.phone !== undefined ? str(body.phone, 20) : cur.phone,
    body?.sim_serial !== undefined ? str(body.sim_serial, 40) : cur.sim_serial,
    body?.carrier !== undefined ? str(body.carrier, 40) : cur.carrier,
    body?.device !== undefined ? str(body.device) : cur.device,
    body?.note !== undefined ? str(body.note, 500) : cur.note,
    status,
    Date.now(),
    byUserId,
    channelId,
  );
  logEvent(null, byUserId, "channel.asset_updated", { channel: channelId, status, phone: body?.phone });
  bus.emit("settings.changed", "channels");
}

/**
 * Bàn giao cho nhân viên mới hoặc thu về kho (toUserId = null).
 * Người giữ cũ: đóng lịch sử, lưu checklist, gỡ quyền vào kênh (nếu quyền đó do bàn giao tạo),
 * chuyển hội thoại họ đang phụ trách ở kênh này sang người mới (hoặc bỏ nhận).
 */
export function handover(
  channelId: number,
  opts: { toUserId: number | null; note?: string; checklist?: Record<string, boolean>; reassign?: boolean },
  byUserId: number,
) {
  const now = Date.now();
  return tx(() => {
    ensureAsset(channelId);
    const cur = get<{ holder_id: number | null; holder_access: number }>("SELECT holder_id, holder_access FROM channel_assets WHERE channel_id = ?", channelId)!;
    const from = cur.holder_id;
    if (from && from === opts.toUserId) throw new Error("Nhân viên này đang giữ tài khoản rồi");
    let moved = 0;
    if (from) {
      run(
        "UPDATE channel_holder_history SET to_at = ?, returned_by = ?, return_note = ?, checklist = ? WHERE channel_id = ? AND user_id = ? AND to_at IS NULL",
        now,
        byUserId,
        str(opts.note, 500),
        JSON.stringify(opts.checklist ?? {}),
        channelId,
        from,
      );
      if (cur.holder_access) run("DELETE FROM user_channels WHERE user_id = ? AND channel_id = ?", from, channelId);
      if (opts.reassign !== false) {
        moved = Number(
          run("UPDATE conversations SET assigned_to = ? WHERE channel_id = ? AND assigned_to = ? AND status != 'closed'", opts.toUserId, channelId, from).changes,
        );
      }
    }
    let access = 0;
    if (opts.toUserId) {
      run("INSERT INTO channel_holder_history(channel_id, user_id, from_at, handed_by, hand_note) VALUES(?, ?, ?, ?, ?)", channelId, opts.toUserId, now, byUserId, from ? null : str(opts.note, 500));
      // Người giữ máy được vào thẳng kênh (nếu chưa có quyền)
      access = Number(run("INSERT OR IGNORE INTO user_channels(user_id, channel_id) VALUES(?, ?)", opts.toUserId, channelId).changes);
    }
    run(
      "UPDATE channel_assets SET holder_id = ?, holder_since = ?, holder_access = ?, status = ?, updated_at = ?, updated_by = ? WHERE channel_id = ?",
      opts.toUserId,
      opts.toUserId ? now : null,
      access,
      opts.toUserId ? "in_use" : "stored",
      now,
      byUserId,
      channelId,
    );
    logEvent(null, byUserId, "channel.handover", { channel: channelId, from, to: opts.toUserId, moved, checklist: opts.checklist ?? null, note: opts.note ?? null });
    bus.emit("settings.changed", "channels");
    bus.emit("settings.changed", "users");
    return { from, to: opts.toUserId, moved };
  });
}

/** Lịch sử: người giữ qua các thời kỳ + sự kiện của tài khoản (bàn giao, sửa hồ sơ, mất kết nối). */
export function accountHistory(channelId: number) {
  const holders = all<any>(
    `SELECT h.*, u.display_name AS user_name, hb.display_name AS handed_by_name, rb.display_name AS returned_by_name
     FROM channel_holder_history h
     LEFT JOIN users u ON u.id = h.user_id
     LEFT JOIN users hb ON hb.id = h.handed_by
     LEFT JOIN users rb ON rb.id = h.returned_by
     WHERE h.channel_id = ? ORDER BY h.from_at DESC LIMIT 100`,
    channelId,
  ).map((h) => ({ ...h, checklist: h.checklist ? JSON.parse(h.checklist) : null }));
  const events = all<any>(
    `SELECT e.type, e.data, e.ts, u.display_name AS by_name FROM events e LEFT JOIN users u ON u.id = e.user_id
     WHERE e.type IN ('channel.disconnected', 'channel.connected', 'channel.handover', 'channel.asset_updated', 'channel.logout', 'channel.holder_deactivated')
       AND json_extract(e.data, '$.channel') = ?
     ORDER BY e.ts DESC LIMIT 200`,
    channelId,
  ).map((e) => ({ ...e, data: e.data ? JSON.parse(e.data) : null }));
  return { holders, events };
}

/** Tài khoản người này đang giữ (hiện ở hồ sơ nhân viên). */
export function accountsHeldBy(userId: number) {
  return all<{ channel_id: number; name: string; phone: string | null; status: string }>(
    "SELECT a.channel_id, ch.name, a.phone, a.status FROM channel_assets a JOIN channels ch ON ch.id = a.channel_id WHERE a.holder_id = ?",
    userId,
  );
}

/** Nhân viên bị khóa / nghỉ mà còn giữ Zalo công ty → đánh dấu cần thu hồi. */
export function onUserDeactivated(userId: number, byUserId: number) {
  const held = accountsHeldBy(userId).filter((a) => a.status === "in_use");
  for (const a of held) {
    run("UPDATE channel_assets SET status = 'revoking', updated_at = ? WHERE channel_id = ?", Date.now(), a.channel_id);
    logEvent(null, byUserId, "channel.holder_deactivated", { channel: a.channel_id, user: userId });
  }
  if (held.length) bus.emit("settings.changed", "channels");
  return held.length;
}

/** Ghi lại các lần Zalo mất kết nối / kết nối lại (dấu hiệu đăng nhập nơi khác, bị đăng xuất). */
export function startAccountWatch() {
  const last = new Map<number, string>();
  bus.on("zalo.status", (st: any) => {
    if (st?.platform && st.platform !== "zalo") return;
    const prev = last.get(st.channelId);
    last.set(st.channelId, st.state);
    if (prev === "connected" && (st.state === "error" || st.state === "disconnected")) {
      logEvent(null, null, "channel.disconnected", { channel: st.channelId, error: st.error ?? null, holder: holderOf(st.channelId) });
    } else if (prev && prev !== "connected" && st.state === "connected") {
      logEvent(null, null, "channel.connected", { channel: st.channelId });
    }
  });
}
