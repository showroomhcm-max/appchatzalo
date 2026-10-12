import type { Capabilities, Platform } from './types'

export const PLATFORM_LABEL: Record<Platform, string> = {
  zalo: 'Zalo',
  facebook: 'Facebook',
  tiktok: 'TikTok',
  tiktok_shop: 'TikTok Shop',
}

/** Ký hiệu ngắn hiện trên ảnh đại diện trong danh sách hội thoại */
const SHORT: Record<Platform, string> = { zalo: 'Z', facebook: 'f', tiktok: 'T', tiktok_shop: 'S' }

/** Tính năng của từng nền tảng (dùng khi danh sách kênh chưa tải xong) */
export const PLATFORM_CAPS: Record<Platform, Capabilities> = {
  zalo: { stickers: true, reactions: true, undo: true, forward: true, quote: true, files: true, contacts: true },
  facebook: { stickers: false, reactions: false, undo: false, forward: false, quote: false, files: true, contacts: false },
  tiktok: { stickers: false, reactions: false, undo: false, forward: false, quote: true, files: false, contacts: false },
  tiktok_shop: { stickers: false, reactions: false, undo: false, forward: false, quote: false, files: false, contacts: false },
}

export const platformOf = (p: string | null | undefined): Platform =>
  p === 'facebook' || p === 'tiktok' || p === 'tiktok_shop' ? p : 'zalo'

/** Nhãn nền tảng dạng viên thuốc (Zalo / Facebook / TikTok / TikTok Shop) */
export function PlatformBadge({ platform, comment }: { platform: string | null | undefined; comment?: boolean }) {
  const p = platformOf(platform)
  return (
    <span className={`platform-badge ${p}`}>
      {PLATFORM_LABEL[p]}
      {comment ? ' · Bình luận' : ''}
    </span>
  )
}

/** Chấm nhỏ góc ảnh đại diện cho biết hội thoại thuộc nền tảng nào */
export function PlatformDot({ platform }: { platform: string | null | undefined }) {
  const p = platformOf(platform)
  return (
    <span className={`platform-dot ${p}`} title={PLATFORM_LABEL[p]} aria-label={PLATFORM_LABEL[p]}>
      {SHORT[p]}
    </span>
  )
}
