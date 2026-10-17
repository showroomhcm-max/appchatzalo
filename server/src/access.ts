import { all } from "./db.js";
import type { AuthUser } from "./auth.js";

/**
 * Phạm vi nhìn thấy của một nhân viên:
 * - Quản trị viên: thấy tất cả.
 * - Nhân viên: thấy toàn bộ hội thoại của kênh được cấp thẳng cho mình;
 *   hội thoại thuộc bộ phận của mình (kể cả được chuyển từ kênh khác sang);
 *   và hội thoại chưa thuộc bộ phận nào trong các kênh mà bộ phận mình được gán.
 */
export type Scope =
  | { all: true; hiddenChannelIds?: number[] }
  | {
      all: false;
      /** Zalo nhân viên đang giám sát mà người này không được xem (không có quyền Giám sát, không phải người giữ máy) */
      hiddenChannelIds?: number[];
      departmentIds: number[];
      /** Kênh dùng được (qua bộ phận hoặc được cấp thẳng) */
      channelIds: number[];
      /** Kênh được cấp thẳng cho nhân viên: thấy toàn bộ hội thoại của kênh */
      fullChannelIds: number[];
      /** Chỉ xem (không dùng kênh): Zalo nhân viên với người có quyền Giám sát */
      viewChannelIds?: number[];
    };

/** Kênh giám sát người này không được xem. */
function hiddenMonitorChannels(user: Pick<AuthUser, "id" | "super_admin" | "permissions">) {
  if (user.super_admin || user.permissions?.includes("monitor.view")) return [];
  return all<{ id: number }>(
    `SELECT ch.id FROM channels ch LEFT JOIN channel_assets a ON a.channel_id = ch.id
     WHERE ch.mode = 'monitor' AND (a.holder_id IS NULL OR a.holder_id != ?)`,
    user.id,
  ).map((r) => r.id);
}

export function scopeOf(user: Pick<AuthUser, "id" | "role" | "super_admin" | "permissions">): Scope {
  const hiddenChannelIds = hiddenMonitorChannels(user);
  if (user.super_admin || user.permissions?.includes("conversations.all")) return { all: true, hiddenChannelIds };
  const departmentIds = all<{ department_id: number }>(
    "SELECT department_id FROM user_departments WHERE user_id = ?",
    user.id,
  ).map((r) => r.department_id);
  const deptChannelIds = departmentIds.length
    ? all<{ channel_id: number }>(
        `SELECT DISTINCT channel_id FROM department_channels WHERE department_id IN (${departmentIds.map(() => "?").join(",")})`,
        ...departmentIds,
      ).map((r) => r.channel_id)
    : [];
  const fullChannelIds = all<{ channel_id: number }>("SELECT channel_id FROM user_channels WHERE user_id = ?", user.id).map(
    (r) => r.channel_id,
  );

  const visible = (id: number) => !hiddenChannelIds.includes(id);
  // Người có quyền Giám sát: xem trọn hội thoại các Zalo nhân viên, nhưng không được dùng các kênh đó
  const viewChannelIds = user.permissions?.includes("monitor.view") ? all<{ id: number }>("SELECT id FROM channels WHERE mode = 'monitor'").map((r) => r.id) : [];
  return {
    all: false,
    departmentIds,
    channelIds: [...new Set([...deptChannelIds, ...fullChannelIds])].filter(visible),
    fullChannelIds: fullChannelIds.filter(visible),
    viewChannelIds,
    hiddenChannelIds,
  };
}

const list = (ids: number[]) => (ids.length ? ids.join(",") : "NULL");

/** Điều kiện SQL lọc hội thoại theo phạm vi (alias bảng conversations mặc định "c"). */
export function conversationFilter(scope: Scope, alias = "c") {
  const hidden = scope.hiddenChannelIds?.length ? ` AND ${alias}.channel_id NOT IN (${scope.hiddenChannelIds.join(",")})` : "";
  if (scope.all) return `(1 = 1${hidden})`;
  // Chỉ chứa số nguyên lấy từ database nên ghép thẳng vào SQL là an toàn.
  return `((${alias}.channel_id IN (${list([...scope.fullChannelIds, ...(scope.viewChannelIds ?? [])])}) OR ${alias}.department_id IN (${list(scope.departmentIds)})
    OR (${alias}.department_id IS NULL AND ${alias}.channel_id IN (${list(scope.channelIds)})))${hidden})`;
}

export function canSeeConversation(scope: Scope, conv: { channel_id: number; department_id: number | null }) {
  if (scope.hiddenChannelIds?.includes(conv.channel_id)) return false;
  if (scope.all) return true;
  if (scope.fullChannelIds.includes(conv.channel_id) || scope.viewChannelIds?.includes(conv.channel_id)) return true;
  if (conv.department_id !== null) return scope.departmentIds.includes(conv.department_id);
  return scope.channelIds.includes(conv.channel_id);
}

/** Zalo nhân viên (chế độ giám sát) mà người này không giữ máy → chỉ được xem, không được thao tác bằng tài khoản đó. */
export function isOthersMonitorChannel(channelId: number, userId: number) {
  const r = all<{ mode: string; holder_id: number | null }>(
    "SELECT ch.mode, a.holder_id FROM channels ch LEFT JOIN channel_assets a ON a.channel_id = ch.id WHERE ch.id = ?",
    channelId,
  )[0];
  return !!r && r.mode === "monitor" && r.holder_id !== userId;
}

export function canUseChannel(scope: Scope, channelId: number) {
  if (scope.hiddenChannelIds?.includes(channelId)) return false;
  return scope.all || scope.channelIds.includes(channelId);
}

/** Tag / tin nhắn mẫu: dùng chung (không gắn bộ phận) hoặc thuộc bộ phận của nhân viên. */
export function departmentItemFilter(scope: Scope, joinTable: string, idColumn: string, alias: string) {
  if (scope.all) return "1 = 1";
  return `(NOT EXISTS (SELECT 1 FROM ${joinTable} j WHERE j.${idColumn} = ${alias}.id)
    OR EXISTS (SELECT 1 FROM ${joinTable} j WHERE j.${idColumn} = ${alias}.id AND j.department_id IN (${list(scope.departmentIds)})))`;
}
