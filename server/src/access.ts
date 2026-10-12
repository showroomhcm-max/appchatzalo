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
  | { all: true }
  | {
      all: false;
      departmentIds: number[];
      /** Kênh dùng được (qua bộ phận hoặc được cấp thẳng) */
      channelIds: number[];
      /** Kênh được cấp thẳng cho nhân viên: thấy toàn bộ hội thoại của kênh */
      fullChannelIds: number[];
    };

export function scopeOf(user: Pick<AuthUser, "id" | "role">): Scope {
  if (user.role === "admin") return { all: true };
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
  return { all: false, departmentIds, channelIds: [...new Set([...deptChannelIds, ...fullChannelIds])], fullChannelIds };
}

const list = (ids: number[]) => (ids.length ? ids.join(",") : "NULL");

/** Điều kiện SQL lọc hội thoại theo phạm vi (alias bảng conversations mặc định "c"). */
export function conversationFilter(scope: Scope, alias = "c") {
  if (scope.all) return "1 = 1";
  // Chỉ chứa số nguyên lấy từ database nên ghép thẳng vào SQL là an toàn.
  return `(${alias}.channel_id IN (${list(scope.fullChannelIds)}) OR ${alias}.department_id IN (${list(scope.departmentIds)})
    OR (${alias}.department_id IS NULL AND ${alias}.channel_id IN (${list(scope.channelIds)})))`;
}

export function canSeeConversation(scope: Scope, conv: { channel_id: number; department_id: number | null }) {
  if (scope.all) return true;
  if (scope.fullChannelIds.includes(conv.channel_id)) return true;
  if (conv.department_id !== null) return scope.departmentIds.includes(conv.department_id);
  return scope.channelIds.includes(conv.channel_id);
}

export function canUseChannel(scope: Scope, channelId: number) {
  return scope.all || scope.channelIds.includes(channelId);
}

/** Tag / tin nhắn mẫu: dùng chung (không gắn bộ phận) hoặc thuộc bộ phận của nhân viên. */
export function departmentItemFilter(scope: Scope, joinTable: string, idColumn: string, alias: string) {
  if (scope.all) return "1 = 1";
  return `(NOT EXISTS (SELECT 1 FROM ${joinTable} j WHERE j.${idColumn} = ${alias}.id)
    OR EXISTS (SELECT 1 FROM ${joinTable} j WHERE j.${idColumn} = ${alias}.id AND j.department_id IN (${list(scope.departmentIds)})))`;
}
