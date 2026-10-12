import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Search } from 'lucide-react'
import { useApp } from './store'
import { Avatar } from './components'
import { PLATFORM_LABEL, PLATFORM_ORDER, PlatformDot, platformOf } from './platform'
import { fold } from './util'

/**
 * Chọn nhanh kênh đang chat ở góc trên (khi được chia nhiều kênh).
 * Hộp thư chỉ hiện hội thoại của các kênh đã chọn.
 */
export default function ChannelPicker() {
  const { channels, workingChannelIds, setWorkingChannels, zaloStatuses } = useApp()
  const list = channels.filter((c) => c.active)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<number[]>([])
  const [q, setQ] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const box = useRef<HTMLDivElement>(null)

  const current = workingChannelIds ? list.filter((c) => workingChannelIds.includes(c.id)).map((c) => c.id) : list.map((c) => c.id)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (list.length < 2) return null

  const shown = list.filter((c) => !q.trim() || fold(c.name).includes(fold(q.trim())))
  const allOn = draft.length === list.length
  const first = list.find((c) => c.id === current[0])

  async function apply() {
    if (!draft.length) {
      setError('Chọn ít nhất 1 kênh')
      return
    }
    setSaving(true)
    setError('')
    try {
      await setWorkingChannels(draft.length >= list.length ? null : draft)
      setOpen(false)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="channel-picker" ref={box}>
      <button
        className={`picker-btn ${open ? 'on' : ''}`}
        onClick={() => {
          setDraft(current)
          setQ('')
          setError('')
          setOpen(!open)
        }}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        {first && (
          <span className="avatar-wrap">
            <Avatar name={first.name} src={first.status?.account?.avatar || first.avatar} size={24} />
            <PlatformDot platform={first.platform} />
          </span>
        )}
        <span>{current.length === list.length ? `Tất cả ${list.length} kênh` : `Đã chọn ${current.length} kênh`}</span>
        <ChevronDown size={16} />
      </button>
      {open && (
        <div className="picker-pop" role="dialog" aria-label="Chọn kênh đang chat">
          <label className="search-box">
            <Search size={16} />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm kênh" aria-label="Tìm kênh" />
          </label>
          <label className="check picker-all">
            <input type="checkbox" checked={allOn} onChange={(e) => setDraft(e.target.checked ? list.map((c) => c.id) : [])} />
            Tất cả kênh
          </label>
          <div className="picker-list">
            {PLATFORM_ORDER.filter((p) => shown.some((c) => platformOf(c.platform) === p)).map((p) => (
              <div key={p}>
                <div className="board-group-title">{PLATFORM_LABEL[p]}</div>
                {shown
                  .filter((c) => platformOf(c.platform) === p)
                  .map((c) => {
                    const st = zaloStatuses.find((s) => s.channelId === c.id) ?? c.status
                    return (
                      <label key={c.id} className="picker-item">
                        <input
                          type="checkbox"
                          checked={draft.includes(c.id)}
                          onChange={(e) => setDraft(e.target.checked ? [...draft, c.id] : draft.filter((x) => x !== c.id))}
                        />
                        <span className="avatar-wrap">
                          <Avatar name={c.name} src={st?.account?.avatar || c.avatar} size={28} />
                          <PlatformDot platform={c.platform} />
                        </span>
                        <span className="grow">{c.name}</span>
                        <span className={`status-dot ${st?.state === 'connected' ? 'ok' : 'bad'}`} title={st?.state === 'connected' ? 'Đã kết nối' : 'Chưa kết nối'} />
                      </label>
                    )
                  })}
              </div>
            ))}
          </div>
          {error && <div className="form-error">{error}</div>}
          <div className="row">
            <span className="small muted grow">
              {draft.length}/{list.length} kênh
            </span>
            <button className="btn ghost sm" onClick={() => setOpen(false)}>
              Hủy
            </button>
            <button className="btn primary sm" disabled={saving} onClick={apply}>
              Áp dụng
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
