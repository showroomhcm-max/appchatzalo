import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Download, ImageOff, Maximize, RotateCw, Search, UserPlus, UsersRound, VideoOff, X, ZoomIn, ZoomOut } from 'lucide-react'
import { api, safeUrl } from '../api'
import type { Conversation, Message } from '../types'
import { Avatar, Modal } from '../components'
import { fold, fullTime } from '../util'

// ───────────── Xem ảnh toàn màn hình (như Zalo): trượt / phím mũi tên để xem ảnh trước, sau ─────────────

const parseParams = (raw: Record<string, any> | null | undefined): Record<string, any> => {
  try {
    const p = raw?.params
    return typeof p === 'string' && p.trim().startsWith('{') ? JSON.parse(p) : p && typeof p === 'object' ? p : {}
  } catch {
    return {}
  }
}

/**
 * Các link ảnh / ảnh bìa Zalo có thể dùng, theo thứ tự thử. Tin nhận qua Zalo web có href / thumb; tin nhập từ Zalo PC
 * còn có hdUrl / oriUrl / normalUrl / thumbUrl; ảnh có bản HD trong params.hd. Link hỏng thì thử link tiếp theo.
 */
export function mediaUrls(raw: Record<string, any> | null | undefined, prefer: 'small' | 'full'): string[] {
  if (!raw) return []
  const p = parseParams(raw)
  const small = [raw.thumb, raw.thumbUrl, raw.href, raw.normalUrl, raw.hdUrl, raw.oriUrl, p.hd]
  const full = [p.hd, raw.hdUrl, raw.href, raw.oriUrl, raw.normalUrl, raw.thumb, raw.thumbUrl]
  const list = (prefer === 'small' ? small : full).map((u) => (typeof u === 'string' ? u.trim() : ''))
  return [...new Set(list.filter((u) => /^https?:\/\//i.test(u) || u.startsWith('/uploads/')))]
}

export const isVideoMessage = (m: Message) => m.msg_type === 'chat.video.msg' && !m.undone && !!(m.raw?.href || m.raw?.thumb || m.raw?.hdUrl)
/** Tin xem được trong khung xem toàn màn hình: ảnh và video */
export const isImageMessage = (m: Message) => (m.msg_type === 'chat.photo' && !m.undone && mediaUrls(m.raw, 'small').length > 0) || isVideoMessage(m)

/** Link video và thời lượng (Zalo để trong params.duration, tính bằng mili giây) */
export function videoInfo(raw: Record<string, any> | null | undefined) {
  const p = parseParams(raw)
  const src = [raw?.href, raw?.hdUrl, raw?.oriUrl, raw?.normalUrl, p.videoUrl, p.video_url].find((u) => typeof u === 'string' && /^https?:\/\/|^\/uploads\//i.test(u)) ?? ''
  const d = Number(p.duration ?? raw?.duration ?? 0)
  const sec = d > 1000 ? Math.round(d / 1000) : Math.round(d)
  return { src: String(src), duration: sec > 0 ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` : '' }
}

/** Ảnh Zalo: link đầu hỏng thì thử link sau; hỏng hết thì báo rõ thay cho ảnh vỡ */
export function FallbackImg({ urls, alt, className, style, draggable, onFail }: {
  urls: string[]
  alt: string
  className?: string
  style?: React.CSSProperties
  draggable?: boolean
  onFail?: () => void
}) {
  const [i, setI] = useState(0)
  const key = urls.join('|')
  useEffect(() => setI(0), [key])
  if (i >= urls.length)
    return (
      <span className="media-missing">
        <ImageOff size={18} /> Ảnh không còn trên Zalo
      </span>
    )
  return (
    <img
      src={urls[i]}
      alt={alt}
      className={className}
      style={style}
      draggable={draggable}
      referrerPolicy="no-referrer"
      loading="lazy"
      onError={() => {
        if (i + 1 >= urls.length) onFail?.()
        setI(i + 1)
      }}
    />
  )
}

export function Lightbox({ images, index, onClose }: { images: Message[]; index: number; onClose: () => void }) {
  const [i, setI] = useState(index)
  // Phóng to / thu nhỏ / xoay: lăn chuột, bấm vào ảnh, chụm 2 ngón; đang phóng to thì kéo để xem phần khác
  const [view, setView] = useState({ scale: 1, x: 0, y: 0, rotate: 0 })
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const gesture = useRef<{ startX: number; startY: number; moved: boolean; pinch: number | null; base: typeof view; onImg: boolean } | null>(null)
  const m = images[i]
  const go = (d: number) => setI((v) => Math.min(images.length - 1, Math.max(0, v + d)))
  // Video không phát được (Zalo đã xóa bản gốc / link hết hạn)
  const [videoFailed, setVideoFailed] = useState(false)
  useEffect(() => {
    setView({ scale: 1, x: 0, y: 0, rotate: 0 })
    setVideoFailed(false)
  }, [i])

  /** Phóng to quanh điểm (px, py) tính từ tâm màn hình, giữ điểm đó đứng yên dưới con trỏ */
  const zoomAt = (next: number, px = 0, py = 0) =>
    setView((v) => {
      const scale = Math.min(6, Math.max(1, next))
      if (scale === 1) return { ...v, scale: 1, x: 0, y: 0 }
      const k = scale / v.scale
      return { ...v, scale, x: px - (px - v.x) * k, y: py - (py - v.y) * k }
    })
  const fromCenter = (e: { clientX: number; clientY: number }) => [e.clientX - window.innerWidth / 2, e.clientY - window.innerHeight / 2] as const

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft') go(-1)
      if (e.key === 'ArrowRight') go(1)
      if (e.key === '+' || e.key === '=') zoomAt(view.scale * 1.25)
      if (e.key === '-') zoomAt(view.scale / 1.25)
      if (e.key === '0') setView({ scale: 1, x: 0, y: 0, rotate: 0 })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [images.length, onClose, view.scale])
  if (!m) return null
  const video = isVideoMessage(m) ? videoInfo(m.raw) : null
  const fullUrls = mediaUrls(m.raw, 'full')
  const src = safeUrl(video ? video.src : fullUrls[0])
  const zoomed = view.scale > 1

  const onPointerDown = (e: React.PointerEvent) => {
    // Nút, link, khung video (tua / âm lượng) giữ thao tác riêng
    if ((e.target as HTMLElement).closest('button, a, video, .media-missing')) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const pts = [...pointers.current.values()]
    gesture.current = {
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
      pinch: pts.length === 2 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : null,
      base: view,
      // Bắt con trỏ rồi thì lúc thả, target là khung xem ảnh: ghi lại lúc nhấn có nhấn vào ảnh không
      onImg: (e.target as HTMLElement).tagName === 'IMG',
    }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const g = gesture.current
    if (!g || !pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const pts = [...pointers.current.values()]
    if (pts.length === 2 && g.pinch) {
      // Chụm / mở 2 ngón
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
      const scale = Math.min(6, Math.max(1, (g.base.scale * d) / g.pinch))
      setView(scale === 1 ? { ...g.base, scale: 1, x: 0, y: 0 } : { ...g.base, scale })
      g.moved = true
      return
    }
    const dx = e.clientX - g.startX
    const dy = e.clientY - g.startY
    if (Math.abs(dx) + Math.abs(dy) > 6) g.moved = true
    // Đang phóng to: kéo để xem phần khác của ảnh
    if (g.base.scale > 1) setView({ ...g.base, x: g.base.x + dx, y: g.base.y + dy })
  }
  const onPointerUp = (e: React.PointerEvent) => {
    const g = gesture.current
    pointers.current.delete(e.pointerId)
    if (!g || pointers.current.size) return
    gesture.current = null
    const dx = e.clientX - g.startX
    if (!g.moved) {
      // Bấm vào ảnh: phóng to 2,5 lần tại chỗ bấm, bấm lại để thu về; bấm ra ngoài ảnh (chưa phóng to) để đóng
      if (g.onImg) {
        const [px, py] = fromCenter(e)
        zoomAt(g.base.scale > 1 ? 1 : 2.5, px, py)
      } else if (g.base.scale === 1) onClose()
      return
    }
    // Chưa phóng to: vuốt ngang để chuyển ảnh
    if (g.base.scale === 1 && !g.pinch && Math.abs(dx) > 50) go(dx < 0 ? 1 : -1)
  }

  return (
    <div
      className={`lightbox ${zoomed ? 'zoomed' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label="Xem ảnh"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={(e) => {
        pointers.current.delete(e.pointerId)
        gesture.current = null
      }}
      onWheel={(e) => {
        if (video) return
        const [px, py] = fromCenter(e)
        zoomAt(view.scale * (e.deltaY < 0 ? 1.2 : 1 / 1.2), px, py)
      }}
    >
      <div className="lightbox-bar">
        <span className="grow">
          {m.direction === 'in' ? m.sender_name ?? 'Khách' : m.agent_name ?? m.holder_name ?? 'Shop'} · {fullTime(m.ts)}
          {images.length > 1 && ` · ${i + 1}/${images.length}`}
        </span>
        {!video && (
          <>
            <button className="icon-btn" onClick={() => zoomAt(view.scale / 1.5)} disabled={!zoomed} aria-label="Thu nhỏ" title="Thu nhỏ (phím -)">
              <ZoomOut size={20} />
            </button>
            <span className="lightbox-zoom">{Math.round(view.scale * 100)}%</span>
            <button
              className="icon-btn"
              onClick={() => zoomAt(view.scale * 1.5)}
              disabled={view.scale >= 6}
              aria-label="Phóng to"
              title="Phóng to (phím +, lăn chuột hoặc bấm vào ảnh)"
            >
              <ZoomIn size={20} />
            </button>
            <button className="icon-btn" onClick={() => setView((v) => ({ ...v, rotate: (v.rotate + 90) % 360 }))} aria-label="Xoay ảnh" title="Xoay ảnh">
              <RotateCw size={20} />
            </button>
          </>
        )}
        {!video && (zoomed || view.rotate !== 0) && (
          <button className="icon-btn" onClick={() => setView({ scale: 1, x: 0, y: 0, rotate: 0 })} aria-label="Về cỡ vừa màn hình" title="Về cỡ vừa màn hình (phím 0)">
            <Maximize size={20} />
          </button>
        )}
        {src && (
          <a
            className="icon-btn"
            href={src}
            target="_blank"
            rel="noreferrer"
            download
            aria-label={video ? 'Tải video' : 'Tải ảnh'}
            title={video ? 'Mở video gốc / tải về' : 'Mở ảnh gốc / tải về'}
          >
            <Download size={20} />
          </a>
        )}
        <button className="icon-btn" onClick={onClose} aria-label="Đóng">
          <X size={22} />
        </button>
      </div>
      {i > 0 && !zoomed && (
        <button className="lightbox-nav prev" onClick={() => go(-1)} aria-label="Ảnh trước">
          <ChevronLeft size={28} />
        </button>
      )}
      {video ? (
        videoFailed || !video.src ? (
          <div className="media-missing big">
            <VideoOff size={28} />
            <b>Video không còn trên Zalo</b>
            <span>Zalo chỉ giữ video một thời gian. Xem trên điện thoại hoặc Zalo PC (nếu máy đã tải về trước đó).</span>
          </div>
        ) : (
          <video
            key={m.id}
            className="lightbox-video"
            src={video.src}
            poster={safeUrl(mediaUrls(m.raw, 'small')[0]) || undefined}
            controls
            autoPlay
            playsInline
            preload="metadata"
            onError={() => setVideoFailed(true)}
          />
        )
      ) : (
        <FallbackImg
          key={m.id}
          urls={fullUrls}
          alt=""
          draggable={false}
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale}) rotate(${view.rotate}deg)` }}
        />
      )}
      {i < images.length - 1 && !zoomed && (
        <button className="lightbox-nav next" onClick={() => go(1)} aria-label="Ảnh sau">
          <ChevronRight size={28} />
        </button>
      )}
    </div>
  )
}

// ───────────── Bảng emoji chèn vào tin nhắn ─────────────

const EMOJI = (
  '😀 😁 😂 🤣 😊 😍 😘 😎 🤗 🤔 😅 😆 😉 😋 😜 🤩 🥰 😇 🙂 🙃 😐 😴 😢 😭 😤 😡 😱 😳 🥺 🙏 ' +
  '👍 👎 👌 ✌️ 🤝 👏 💪 🙌 👋 ☝️ 👉 👈 ❤️ 🧡 💛 💚 💙 💜 🖤 💯 🔥 ✨ 🎉 🎁 🌹 ⭐ ✅ ❌ ⚠️ ❓ ' +
  '📦 🚚 💳 💰 🧾 📞 📱 💻 🖥️ ⌨️ 🖱️ 🎧 🎮 💾 📷 ⏰ 📍 🏪 🆗 🆕'
).split(' ')

export function EmojiPicker({ onPick, onClose }: { onPick: (e: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose()
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [onClose])
  return (
    <div className="emoji-picker" ref={ref} role="dialog" aria-label="Chọn emoji">
      {EMOJI.map((e) => (
        <button key={e} type="button" onMouseDown={(ev) => ev.preventDefault()} onClick={() => onPick(e)} aria-label={e}>
          {e}
        </button>
      ))}
    </div>
  )
}

// ───────────── Tìm trong hội thoại ─────────────

type Hit = { id: number; text: string | null; ts: number; direction: 'in' | 'out'; sender_name: string | null; agent_name: string | null }

export function InChatSearch({ convId, onJump, onClose }: { convId: string; onJump: (msgId: number) => void; onClose: () => void }) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Hit[] | null>(null)
  useEffect(() => {
    if (q.trim().length < 2) return setHits(null)
    const t = window.setTimeout(() => {
      api<Hit[]>(`/search/messages?q=${encodeURIComponent(q.trim())}&conversationId=${encodeURIComponent(convId)}&limit=50`)
        .then(setHits)
        .catch(() => setHits([]))
    }, 300)
    return () => window.clearTimeout(t)
  }, [q, convId])
  const needle = fold(q.trim())
  const mark = (text: string) => {
    const i = fold(text).indexOf(needle)
    if (i < 0 || !needle) return text
    return (
      <>
        {text.slice(0, i)}
        <mark>{text.slice(i, i + needle.length)}</mark>
        {text.slice(i + needle.length)}
      </>
    )
  }
  return (
    <div className="inchat-search">
      <label className="search-box">
        <Search size={16} />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm tin nhắn trong hội thoại này" aria-label="Tìm trong hội thoại" onKeyDown={(e) => e.key === 'Escape' && onClose()} />
        <button className="icon-btn sm" onClick={onClose} aria-label="Đóng tìm kiếm">
          <X size={14} />
        </button>
      </label>
      {hits && (
        <div className="inchat-results">
          {!hits.length && <div className="muted small pad">Không tìm thấy.</div>}
          {hits.map((h) => (
            <button key={h.id} onClick={() => onJump(h.id)}>
              <span className="small muted">
                {h.direction === 'in' ? h.sender_name ?? 'Khách' : h.agent_name ?? 'Shop'} · {fullTime(h.ts)}
              </span>
              <span>{mark(h.text ?? '')}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ───────────── Trạng thái tin đã gửi (Zalo) ─────────────

export function receiptLabel(conv: Conversation | null, m: Message) {
  if (!conv || m.direction !== 'out' || m.undone) return null
  if (conv.seen_ts && m.ts <= conv.seen_ts) return conv.type === 1 && conv.seen_count ? `${conv.seen_count} người đã xem` : 'Đã xem'
  if (conv.delivered_ts && m.ts <= conv.delivered_ts) return 'Đã nhận'
  return 'Đã gửi'
}

// ───────────── Thành viên nhóm Zalo + thêm người vào nhóm ─────────────

export type GroupMember = { uid: string; name: string; avatar: string; role: 'owner' | 'admin' | 'member' }
type MembersData = { name: string; total: number; members: GroupMember[]; selfId: string | null }

/** Lấy thành viên nhóm (dùng chung cho mục Thành viên và gợi ý @nhắc tên) */
const membersCache = new Map<string, { at: number; data: Promise<MembersData> }>()
export function loadMembers(convId: string, refresh = false) {
  const c = membersCache.get(convId)
  if (!refresh && c && Date.now() - c.at < 5 * 60_000) return c.data
  const data = api<MembersData>(`/conversations/${encodeURIComponent(convId)}/members`)
  data.catch(() => membersCache.delete(convId))
  membersCache.set(convId, { at: Date.now(), data })
  return data
}

export function GroupMembers({ conv }: { conv: Conversation }) {
  const [data, setData] = useState<MembersData | null>(null)
  const [error, setError] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [adding, setAdding] = useState(false)
  const reload = (refresh = false) =>
    loadMembers(conv.id, refresh)
      .then(setData)
      .catch((e) => setError(e.message))
  useEffect(() => {
    setData(null)
    setError('')
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conv.id])
  const list = data ? (showAll ? data.members : data.members.slice(0, 8)) : []
  return (
    <div className="info-section">
      <div className="section-title row">
        <span className="grow">
          <UsersRound size={14} /> Thành viên{data ? ` (${data.total})` : ''}
        </span>
        <button className="btn outline sm" onClick={() => setAdding(true)} disabled={!data}>
          <UserPlus size={14} /> Thêm
        </button>
      </div>
      {!data && !error && <span className="muted small">Đang tải…</span>}
      {error && <span className="small err-text">{error}</span>}
      <div className="member-list">
        {list.map((m) => (
          <div key={m.uid} className="member-row">
            <Avatar name={m.name} src={m.avatar} size={28} />
            <span className="grow">{m.name}</span>
            {m.role !== 'member' && <span className="badge lime">{m.role === 'owner' ? 'Trưởng nhóm' : 'Phó nhóm'}</span>}
          </div>
        ))}
      </div>
      {data && data.members.length > 8 && (
        <button className="link-btn" onClick={() => setShowAll((v) => !v)}>
          {showAll ? 'Thu gọn' : `Xem tất cả ${data.members.length} thành viên`}
        </button>
      )}
      {adding && data && (
        <AddMembersModal
          conv={conv}
          existing={new Set(data.members.map((m) => m.uid))}
          onClose={() => setAdding(false)}
          onDone={() => {
            setAdding(false)
            void reload(true)
          }}
        />
      )}
    </div>
  )
}

function AddMembersModal({ conv, existing, onClose, onDone }: { conv: Conversation; existing: Set<string>; onClose: () => void; onDone: () => void }) {
  const [friends, setFriends] = useState<{ uid: string; name: string; avatar: string; phone: string | null }[] | null>(null)
  const [picked, setPicked] = useState<string[]>([])
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    api<NonNullable<typeof friends>>(`/zalo/${conv.channel_id}/friends`)
      .then((f) => setFriends(f.filter((x) => !existing.has(x.uid))))
      .catch((e) => setError(e.message))
  }, [conv.channel_id, existing])
  const shown = (friends ?? []).filter((f) => !q.trim() || fold(f.name).includes(fold(q.trim())) || (f.phone ?? '').includes(q.trim())).slice(0, 150)

  async function add() {
    setBusy(true)
    setError('')
    try {
      const r = await api<{ added: number; failed: string[] }>(`/conversations/${encodeURIComponent(conv.id)}/members`, { body: { uids: picked } })
      if (r.failed.length) alert(`Đã thêm ${r.added} người. ${r.failed.length} người chưa thêm được (có thể họ chặn được thêm vào nhóm, hoặc nhóm cần trưởng nhóm duyệt).`)
      onDone()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={`Thêm người vào ${conv.name ?? 'nhóm'}`} onClose={onClose}>
      <div className="stack">
        <div className="field">
          <span>Bạn bè Zalo · đã chọn {picked.length}</span>
          <label className="search-box">
            <Search size={16} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm tên, số điện thoại" aria-label="Tìm bạn bè" autoFocus />
          </label>
          <div className="friend-pick">
            {!friends && !error && <div className="muted small pad">Đang tải danh sách bạn bè…</div>}
            {friends && !shown.length && <div className="muted small pad">Không có bạn bè phù hợp (người đã trong nhóm không hiện).</div>}
            {shown.map((f) => (
              <label key={f.uid} className="picker-item">
                <input type="checkbox" checked={picked.includes(f.uid)} onChange={(e) => setPicked(e.target.checked ? [...picked, f.uid] : picked.filter((x) => x !== f.uid))} />
                <Avatar name={f.name} src={f.avatar} size={28} />
                <span className="grow">{f.name}</span>
                {f.phone && <span className="small muted">{f.phone}</span>}
              </label>
            ))}
          </div>
        </div>
        {error && <div className="form-error">{error}</div>}
        <div className="row end">
          <button className="btn ghost" onClick={onClose}>
            Hủy
          </button>
          <button className="btn primary" disabled={busy || !picked.length} onClick={add}>
            <UserPlus size={16} /> Thêm {picked.length || ''} người
          </button>
        </div>
      </div>
    </Modal>
  )
}
