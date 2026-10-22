import { all, get, logEvent, run } from "./db.js";
import { bus } from "./bus.js";
import { conversationKey, ensureConversation, getConversation, updateConversationProfile } from "./store.js";
import { zalo, type ZaloPerson } from "./zalo.js";
import { HttpError } from "./conversations.js";
import { canSeeConversation, canUseChannel, conversationFilter, type Scope, isOthersMonitorChannel } from "./access.js";
import { fold, likePattern } from "./text.js";

/** "0909 123 456", "+84909123456", "84909123456" → "0909123456". Không phải số điện thoại → null. */
export function normalizePhone(q: string) {
  const digits = q.replace(/[\s.\-()]/g, "");
  if (!/^\+?\d{9,13}$/.test(digits)) return null;
  const d = digits.replace(/^\+/, "");
  if (d.startsWith("84") && d.length >= 11) return "0" + d.slice(2);
  return d;
}

export type ContactResult = {
  uid: string;
  channel_id: number;
  channel_name: string | null;
  name: string;
  avatar: string | null;
  phone: string | null;
  /** conversation = đã từng chat, friend = bạn bè Zalo, phone = tra qua số điện thoại, group = nhóm Zalo */
  source: "conversation" | "friend" | "phone" | "group";
  is_friend: boolean | null;
  is_group: boolean;
  conversation_id: string | null;
  last_message_preview: string | null;
  last_message_at: number | null;
};

// Kết quả tra số điện thoại lưu 24 giờ (theo từng kênh) để gõ lại không tốn lượt tra của Zalo.
const phoneCache = new Map<string, { at: number; person: ZaloPerson | null }>();

async function lookupPhone(channelId: number, phone: string) {
  const key = `${channelId}:${phone}`;
  const cached = phoneCache.get(key);
  if (cached && Date.now() - cached.at < 24 * 3600_000) return cached.person;
  const person = await zalo.zaloSession(channelId).findByPhone(phone);
  phoneCache.set(key, { at: Date.now(), person });
  return person;
}

function channelName(id: number) {
  return get<{ name: string }>("SELECT name FROM channels WHERE id = ?", id)?.name ?? null;
}

/** Kênh dùng để tìm bạn bè / tra số: kênh được chọn, hoặc kênh đầu tiên đang kết nối mà người này dùng được. */
export function pickChannel(access: Scope, requested?: number, userId: number | null = null) {
  // Zalo nhân viên đang giám sát chỉ người giữ máy được dùng (tra số, mở chat)
  const othersMonitor = (id: number) => isOthersMonitorChannel(id, userId ?? 0);
  if (requested) {
    if (!canUseChannel(access, requested) || othersMonitor(requested)) throw new HttpError(403, "Bạn không có quyền dùng kênh này");
    return get<{ platform: string }>("SELECT platform FROM channels WHERE id = ?", requested)?.platform === "zalo" ? requested : null;
  }
  // Tìm bạn bè / tra số điện thoại chỉ làm được qua kênh Zalo
  const ids = all<{ id: number }>("SELECT id FROM channels WHERE active = 1 AND platform = 'zalo' ORDER BY id").map((r) => r.id);
  const usable = ids.filter((id) => canUseChannel(access, id) && !othersMonitor(id));
  return usable.find((id) => zalo.session(id).connected) ?? usable[0] ?? null;
}

/**
 * Tìm "Liên hệ" như ô tìm kiếm của Zalo: hội thoại đã có, bạn bè Zalo, và tra số điện thoại
 * (tự động khi gõ đủ số di động 10 số, có cache để không tốn lượt tra).
 */
export async function searchContacts(rawQuery: string, opts: { access: Scope; channelId?: number; userId?: number | null }) {
  const q = rawQuery.trim();
  const empty = { contacts: [] as ContactResult[], phone_lookup: false, phone_error: null as string | null, channel_id: null };
  if (!q) return empty;
  const phone = normalizePhone(q);
  const like = likePattern(q);
  const digits = q.replace(/\D/g, "");

  const convRows = all(
    `SELECT c.id, c.channel_id, c.thread_id, c.type, c.name, c.avatar, c.phone, c.last_message_preview, c.last_message_at,
            ch.name AS channel_name
     FROM conversations c LEFT JOIN channels ch ON ch.id = c.channel_id
     WHERE ${conversationFilter(opts.access)} ${opts.channelId ? `AND c.channel_id = ${Number(opts.channelId)}` : ""}
       AND (fold(c.name) LIKE ? ESCAPE '\\' OR c.thread_id LIKE ? OR fold(c.external_ref) LIKE ? ESCAPE '\\'
            ${digits.length >= 4 ? "OR c.phone LIKE ?" : ""})
     ORDER BY COALESCE(c.last_message_at, c.created_at) DESC LIMIT 20`,
    like,
    `%${q}%`,
    like,
    ...(digits.length >= 4 ? [`%${phone ? phone.slice(1) : digits}%`] : []),
  );
  const contacts: ContactResult[] = convRows.map((c) => ({
    uid: c.thread_id,
    channel_id: c.channel_id,
    channel_name: c.channel_name,
    name: c.name ?? c.thread_id,
    avatar: c.avatar,
    phone: c.phone,
    source: "conversation",
    is_friend: null,
    is_group: c.type === 1,
    conversation_id: c.id,
    last_message_preview: c.last_message_preview,
    last_message_at: c.last_message_at,
  }));
  let phoneError: string | null = null;

  const channelId = pickChannel(opts.access, opts.channelId, opts.userId ?? null);
  if (channelId && zalo.session(channelId).connected) {
    const seen = new Set(contacts.filter((c) => c.channel_id === channelId).map((c) => c.uid));
    // Tra số khi đã gõ đủ số di động Việt Nam (10 số bắt đầu bằng 0).
    if (phone && /^0\d{9}$/.test(phone)) {
      try {
        const p = await lookupPhone(channelId, phone);
        if (p) {
          const existing = contacts.find((c) => c.uid === p.uid && c.channel_id === channelId);
          if (existing) existing.phone ??= phone;
          else {
            contacts.unshift(toContact(p, channelId, opts.access, "phone", phone));
            seen.add(p.uid);
          }
        }
      } catch (e: any) {
        phoneError = e?.message ?? "Không tra được số điện thoại";
      }
    }
    try {
      const needle = fold(q);
      const friendDigits = phone ? phone.slice(1) : digits.length >= 4 ? digits : null;
      for (const f of await zalo.zaloSession(channelId).friends()) {
        if (seen.has(f.uid)) {
          const c = contacts.find((x) => x.uid === f.uid && x.channel_id === channelId);
          if (c) c.is_friend = true;
          continue;
        }
        const hit =
          fold(f.name).includes(needle) ||
          fold(f.zaloName).includes(needle) ||
          (friendDigits && f.phone?.replace(/\D/g, "").includes(friendDigits));
        if (hit) {
          contacts.push(toContact(f, channelId, opts.access, "friend"));
          seen.add(f.uid);
        }
        if (contacts.length >= 40) break;
      }
    } catch (e: any) {
      console.warn("[search] Không tải được danh sách bạn bè:", e?.message ?? e);
    }
    // Nhóm Zalo trùng tên (kể cả nhóm chưa từng nhắn trong app)
    try {
      const needle = fold(q);
      for (const g of await zalo.zaloSession(channelId).groups()) {
        if (!fold(g.name).includes(needle)) continue;
        const existing = contacts.find((c) => c.uid === g.groupId && c.channel_id === channelId);
        if (existing) continue;
        const conv = getConversation(conversationKey(channelId, g.groupId));
        const visible = conv && canSeeConversation(opts.access, conv);
        contacts.push({
          uid: g.groupId,
          channel_id: channelId,
          channel_name: channelName(channelId),
          name: g.name,
          avatar: g.avatar,
          phone: null,
          source: "group",
          is_friend: null,
          is_group: true,
          conversation_id: visible ? conv.id : null,
          last_message_preview: visible ? conv.last_message_preview : `${g.members} thành viên`,
          last_message_at: visible ? conv.last_message_at : null,
        });
        if (contacts.length >= 60) break;
      }
    } catch (e: any) {
      console.warn("[search] Không tải được danh sách nhóm:", e?.message ?? e);
    }
  }

  return { contacts, phone_lookup: !!phone && /^0\d{9}$/.test(phone), phone_error: phoneError, channel_id: channelId };
}

function toContact(p: ZaloPerson, channelId: number, access: Scope, source: "friend" | "phone", phone?: string): ContactResult {
  const conv = getConversation(conversationKey(channelId, p.uid));
  const visible = conv && canSeeConversation(access, conv);
  return {
    uid: p.uid,
    channel_id: channelId,
    channel_name: channelName(channelId),
    name: p.name,
    avatar: p.avatar,
    phone: phone ?? p.phone,
    source,
    is_friend: p.isFriend,
    is_group: false,
    conversation_id: visible ? conv.id : null,
    last_message_preview: visible ? conv.last_message_preview : null,
    last_message_at: visible ? conv.last_message_at : null,
  };
}

/** Tìm trong nội dung tin nhắn (không dấu), mới nhất trước, chỉ trong hội thoại người này được xem. */
export function searchMessages(
  rawQuery: string,
  opts: { access: Scope; before?: number; limit?: number; conversationId?: string; channelId?: number },
) {
  const q = rawQuery.trim();
  if (q.length < 2) return [];
  const params: any[] = [likePattern(q)];
  let where = `m.undone = 0 AND fold(m.text) LIKE ? ESCAPE '\\' AND ${conversationFilter(opts.access)}`;
  if (opts.conversationId) {
    where += " AND m.conversation_id = ?";
    params.push(opts.conversationId);
  }
  if (opts.channelId) {
    where += " AND c.channel_id = ?";
    params.push(opts.channelId);
  }
  if (opts.before) {
    where += " AND m.ts < ?";
    params.push(opts.before);
  }
  params.push(Math.min(opts.limit ?? 30, 100));
  return all(
    `SELECT m.id, m.conversation_id, m.direction, m.text, m.ts, m.msg_type, m.sender_name,
            u.display_name AS agent_name, c.name AS conversation_name, c.avatar AS conversation_avatar,
            c.type AS conversation_type, ch.name AS channel_name
     FROM messages m
     JOIN conversations c ON c.id = m.conversation_id
     LEFT JOIN channels ch ON ch.id = c.channel_id
     LEFT JOIN users u ON u.id = m.agent_id
     WHERE ${where}
     ORDER BY m.ts DESC, m.id DESC LIMIT ?`,
    ...params,
  );
}

/**
 * Mở (hoặc tạo) hội thoại với một người dùng Zalo để nhân viên nhắn tin đầu tiên.
 * Nếu bộ phận mặc định của kênh không phải bộ phận của người mở, hội thoại vào bộ phận của người mở
 * (để họ còn thấy hội thoại vừa tạo).
 */
export function openConversationWith(
  person: { uid: string; channel_id?: number; name?: string | null; avatar?: string | null; phone?: string | null; is_group?: boolean },
  access: Scope,
  byUserId: number | null,
) {
  const uid = String(person.uid ?? "").trim();
  if (!/^\d{5,25}$/.test(uid)) throw new HttpError(400, "ID người dùng Zalo không hợp lệ");
  const channelId = pickChannel(access, person.channel_id ? Number(person.channel_id) : undefined, byUserId);
  if (!channelId) throw new HttpError(400, "Chưa có kênh Zalo nào để nhắn tin");

  const { id, created } = ensureConversation(channelId, uid, person.is_group ? 1 : 0, { name: person.name ?? null, avatar: person.avatar ?? null });
  const phone = person.phone ? normalizePhone(String(person.phone)) : null;
  // Hội thoại đã có mà người này không được xem: dừng trước khi sửa tên / ảnh / SĐT của nó
  if (!created && !access.all && !canSeeConversation(access, getConversation(id)!)) throw new HttpError(403, "Hội thoại này thuộc bộ phận khác");
  if (phone) run("UPDATE conversations SET phone = COALESCE(phone, ?) WHERE id = ?", phone, id);
  if (!created && (person.name || person.avatar)) updateConversationProfile(id, { name: person.name, avatar: person.avatar });

  let conv = getConversation(id)!;
  if (!access.all && !canSeeConversation(access, conv)) {
    const linked = all<{ department_id: number }>("SELECT department_id FROM department_channels WHERE channel_id = ?", channelId)
      .map((r) => r.department_id)
      .filter((d) => access.departmentIds.includes(d));
    run("UPDATE conversations SET department_id = ? WHERE id = ?", linked[0] ?? access.departmentIds[0] ?? null, id);
    conv = getConversation(id)!;
  }
  if (created) {
    logEvent(id, byUserId, "conversation.started", { phone, channel: channelId });
    bus.emit("conversation.updated", conv);
  }
  return conv;
}
