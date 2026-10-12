import { useState } from 'react'
import { Check, Search } from 'lucide-react'
import type { Tag } from '../types'
import { fold } from '../util'

/**
 * Toàn bộ tag hiện sẵn thành nút bấm (bấm để gắn / bỏ), kèm ô tìm tag.
 * Dùng cho gắn tag hội thoại và lọc danh sách theo tag.
 */
export default function TagPicker({
  tags,
  selected,
  onToggle,
  compact = false,
  emptyText = 'Chưa có tag.',
}: {
  tags: Tag[]
  selected: string[]
  onToggle: (name: string) => void
  compact?: boolean
  emptyText?: string
}) {
  const [q, setQ] = useState('')
  const needle = fold(q.trim())
  const shown = needle ? tags.filter((t) => fold(t.name).includes(needle)) : tags
  // Tag đang chọn luôn hiện, kể cả khi đang tìm chữ khác
  const extra = tags.filter((t) => selected.includes(t.name) && !shown.includes(t))

  if (!tags.length) return <div className="muted small">{emptyText}</div>

  return (
    <div className={`tag-picker ${compact ? 'compact' : ''}`}>
      {tags.length > 6 && (
        <div className="search tag-search">
          <Search size={13} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm tag…" aria-label="Tìm tag" />
        </div>
      )}
      <div className="tag-options">
        {[...extra, ...shown].map((t) => {
          const on = selected.includes(t.name)
          return (
            <button
              type="button"
              key={t.id}
              className={`tag-option ${on ? 'on' : ''}`}
              style={{ '--chip': t.color } as React.CSSProperties}
              onClick={() => onToggle(t.name)}
              aria-pressed={on}
            >
              {on && <Check size={12} />}
              {t.name}
            </button>
          )
        })}
        {needle && !shown.length && <span className="muted small">Không có tag "{q.trim()}".</span>}
      </div>
    </div>
  )
}
