import { Monitor, Moon, Sun } from 'lucide-react'
import { nextTheme, setThemePref, THEME_LABEL, useThemePref, type ThemePref } from './theme'

const ICON: Record<ThemePref, typeof Sun> = { light: Sun, dark: Moon, system: Monitor }

/** Nút ở thanh bên (máy tính): bấm đổi Sáng → Tối → Theo máy. */
export function ThemeButton() {
  const pref = useThemePref()
  const Icon = ICON[pref]
  const label = `Giao diện: ${THEME_LABEL[pref]} · bấm để chuyển sang ${THEME_LABEL[nextTheme(pref)]}`
  return (
    <button className="icon-btn" onClick={() => setThemePref(nextTheme(pref))} title={label} aria-label={label}>
      <Icon size={18} />
    </button>
  )
}

/** Chọn giao diện trong menu tài khoản (điện thoại). */
export function ThemeChoice() {
  const pref = useThemePref()
  return (
    <div className="sheet-row static">
      <span className="sheet-ic">
        <Moon size={20} />
      </span>
      <span className="grow">Giao diện</span>
      <div className="seg sm theme-seg" role="radiogroup" aria-label="Giao diện sáng / tối">
        {(['light', 'dark', 'system'] as const).map((p) => (
          <button key={p} role="radio" aria-checked={pref === p} className={pref === p ? 'on' : ''} onClick={() => setThemePref(p)}>
            {THEME_LABEL[p]}
          </button>
        ))}
      </div>
    </div>
  )
}
