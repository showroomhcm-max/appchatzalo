import type { User } from './types'

export type Permission =
  | 'conversations.all'
  | 'conversations.assign'
  | 'messages.undo_any'
  | 'reviews.manage'
  | 'data.view'
  | 'data.export'
  | 'channels.manage'
  | 'users.manage'
  | 'departments.manage'
  | 'tags.manage'
  | 'templates.manage'
  | 'alerts.manage'
  | 'integrations.manage'
  | 'logs.view'
  | 'permissions.manage'

/** Người này có quyền không (Super Admin luôn có). */
export function can(user: Pick<User, 'super_admin' | 'permissions'> | null | undefined, perm: Permission) {
  return !!user && (!!user.super_admin || !!user.permissions?.includes(perm))
}

export function canAny(user: Pick<User, 'super_admin' | 'permissions'> | null | undefined, perms: Permission[]) {
  return perms.some((p) => can(user, p))
}
