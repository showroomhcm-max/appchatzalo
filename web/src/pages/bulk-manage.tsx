import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import { api } from '../api'
import { useApp } from '../store'
import { fold } from '../util'

/** Lọc theo bộ phận: tất cả / dùng chung (không gắn bộ phận) / một bộ phận. */
export type DeptFilter = 'all' | 'shared' | number

export const matchDept = (ids: number[], f: DeptFilter) => f === 'all' || (f === 'shared' ? ids.length === 0 : ids.includes(f))
export const matchText = (q: string, ...fields: (string | null | undefined)[]) => {
  const k = fold(q.trim())
  return !k || fields.some((f) => fold(f).includes(k))
}

export function ListFilter({
  q,
  onQ,
  dept,
  onDept,
  placeholder,
  shown,
  total,
}: {
  q: string
  onQ: (v: string) => void
  dept: DeptFilter
  onDept: (v: DeptFilter) => void
  placeholder: string
  shown: number
  total: number
}) {
  const { departments } = useApp()
  return (
    <div className="list-filter">
      <label className="list-filter-search">
        <Search size={16} />
        <input value={q} onChange={(e) => onQ(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
        {q && (
          <button type="button" className="icon-btn sm" onClick={() => onQ('')} aria-label="Xóa ô tìm">
            <X size={14} />
          </button>
        )}
      </label>
      <select
        className="select"
        value={String(dept)}
        onChange={(e) => onDept(e.target.value === 'all' || e.target.value === 'shared' ? e.target.value : Number(e.target.value))}
        aria-label="Lọc theo bộ phận"
      >
        <option value="all">Mọi bộ phận</option>
        <option value="shared">Dùng chung (chưa gắn bộ phận)</option>
        {departments.map((d) => (
          <option key={d.id} value={d.id}>
            Bộ phận {d.name}
          </option>
        ))}
      </select>
      {shown !== total && (
        <span className="muted small">
          Đang hiện {shown}/{total}
        </span>
      )}
    </div>
  )
}

/** Chọn nhiều dòng; tự bỏ chọn những dòng không còn hiện (đổi bộ lọc, bị xóa). */
export function useSelection(visibleIds: number[]) {
  const [selected, setSelected] = useState<number[]>([])
  const key = visibleIds.join(',')
  useEffect(() => {
    setSelected((s) => s.filter((id) => visibleIds.includes(id)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  const allOn = visibleIds.length > 0 && visibleIds.every((id) => selected.includes(id))
  return {
    selected,
    has: (id: number) => selected.includes(id),
    toggle: (id: number) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id])),
    allOn,
    someOn: selected.length > 0 && !allOn,
    toggleAll: () => setSelected(allOn ? [] : visibleIds),
    clear: () => setSelected([]),
  }
}

/** Ô chọn ở tiêu đề bảng: chọn / bỏ chọn mọi dòng đang hiện. */
export function SelectAllBox({ allOn, someOn, onToggle, label }: { allOn: boolean; someOn: boolean; onToggle: () => void; label: string }) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = someOn
  }, [someOn])
  return <input ref={ref} type="checkbox" checked={allOn} onChange={onToggle} aria-label={label} />
}

type Mode = 'add' | 'remove' | 'set'
const MODE_LABEL: Record<Mode, string> = {
  add: 'Thêm bộ phận',
  remove: 'Bỏ bộ phận',
  set: 'Đặt lại bộ phận (thay toàn bộ)',
}

/** Thanh sửa bộ phận dùng cho các dòng đang chọn. */
export function BulkDeptBar({
  kind,
  ids,
  noun,
  onDone,
  onClear,
}: {
  kind: 'tags' | 'templates'
  ids: number[]
  noun: string
  onDone: (updated: number) => void
  onClear: () => void
}) {
  const { departments } = useApp()
  const [mode, setMode] = useState<Mode>('add')
  const [depts, setDepts] = useState<number[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const names = useMemo(() => departments.filter((d) => depts.includes(d.id)).map((d) => d.name), [departments, depts])

  async function apply() {
    setBusy(true)
    setError('')
    try {
      const r = await api<{ updated: number }>(`/${kind}/bulk-departments`, { body: { ids, mode, department_ids: depts } })
      setDepts([])
      onDone(r.updated)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const summary =
    mode === 'set' && !depts.length
      ? `${ids.length} ${noun} sẽ thành dùng chung cho mọi bộ phận`
      : !depts.length
        ? 'Chọn bộ phận bên dưới'
        : `${mode === 'add' ? 'Thêm' : mode === 'remove' ? 'Bỏ' : 'Chỉ dùng cho'} ${names.join(', ')} ${mode === 'remove' ? 'khỏi' : 'ở'} ${ids.length} ${noun}`

  return (
    <div className="bulk-bar" role="region" aria-label={`Sửa hàng loạt ${noun} đã chọn`}>
      <div className="bulk-bar-head">
        <b>Đã chọn {ids.length} {noun}</b>
        <select className="select" value={mode} onChange={(e) => setMode(e.target.value as Mode)} aria-label="Cách đổi bộ phận">
          {(Object.keys(MODE_LABEL) as Mode[]).map((m) => (
            <option key={m} value={m}>
              {MODE_LABEL[m]}
            </option>
          ))}
        </select>
        <span className="grow" />
        <button type="button" className="btn ghost sm" onClick={onClear}>
          Bỏ chọn
        </button>
      </div>
      <div className="bulk-bar-depts">
        {departments.map((d) => (
          <label key={d.id} className="check">
            <input
              type="checkbox"
              checked={depts.includes(d.id)}
              onChange={(e) => setDepts(e.target.checked ? [...depts, d.id] : depts.filter((x) => x !== d.id))}
            />
            <span className="dept-chip" style={{ '--chip': d.color } as React.CSSProperties}>
              {d.name}
            </span>
          </label>
        ))}
        {!departments.length && <span className="muted small">Chưa có bộ phận nào. Tạo ở Cài đặt › Bộ phận.</span>}
      </div>
      <div className="bulk-bar-foot">
        <span className="small muted">{summary}</span>
        <span className="grow" />
        <button type="button" className="btn primary sm" disabled={busy || (mode !== 'set' && !depts.length)} onClick={apply}>
          {busy ? 'Đang lưu…' : 'Áp dụng'}
        </button>
      </div>
      {error && <div className="form-error">{error}</div>}
    </div>
  )
}
