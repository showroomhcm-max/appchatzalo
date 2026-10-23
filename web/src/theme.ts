/**
 * Giao diện sáng / tối: lựa chọn lưu riêng từng máy (localStorage). "Theo máy" đi theo cài đặt sáng / tối của
 * Windows, điện thoại. Gắn data-theme lên <html>; public/theme-init.js đã gắn sẵn trước khi vẽ để khỏi nháy trắng.
 */
import { useSyncExternalStore } from 'react'

export type ThemePref = 'light' | 'dark' | 'system'
const KEY = 'zcskh.theme'
const media = window.matchMedia?.('(prefers-color-scheme: dark)')
const listeners = new Set<() => void>()

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

let pref = readPref()

function apply() {
  const dark = pref === 'dark' || (pref === 'system' && !!media?.matches)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0b120f' : '#063a21')
}

export function startTheme() {
  apply()
  media?.addEventListener('change', () => {
    if (pref === 'system') apply()
  })
}

export function setThemePref(next: ThemePref) {
  pref = next
  try {
    if (next === 'system') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, next)
  } catch {}
  apply()
  for (const l of listeners) l()
}

export const THEME_LABEL: Record<ThemePref, string> = { light: 'Sáng', dark: 'Tối', system: 'Theo máy' }
/** Bấm nút: Sáng → Tối → Theo máy → Sáng */
export const nextTheme = (p: ThemePref): ThemePref => (p === 'light' ? 'dark' : p === 'dark' ? 'system' : 'light')

export function useThemePref() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => pref,
  )
}
