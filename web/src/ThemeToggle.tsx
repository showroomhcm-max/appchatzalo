import { Moon } from 'lucide-react'
import { setThemePref, THEME_LABEL, useThemePref } from './theme'

/** Chọn giao diện sáng / tối (menu tài khoản trên máy tính và điện thoại). */
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
