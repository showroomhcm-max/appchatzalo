import { useEffect, useState } from 'react'
import { Copy, Download, RefreshCw, Search } from 'lucide-react'
import { api, authUrl } from '../api'

type LogLine = { ts: number; level: 'info' | 'warn' | 'error'; msg: string }

function vnTime(ts: number) {
  return new Date(ts).toLocaleString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    day: '2-digit',
    month: '2-digit',
  })
}

/** Cài đặt › Nhật ký: xem log hệ thống, tải về gửi kiểm tra lỗi. */
export default function LogsTab() {
  const [level, setLevel] = useState('warn')
  const [q, setQ] = useState('')
  const [list, setList] = useState<LogLine[] | null>(null)
  const [auto, setAuto] = useState(true)
  const [copied, setCopied] = useState(false)

  const load = () =>
    api<LogLine[]>(`/logs?level=${level}&limit=500${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ''}`)
      .then(setList)
      .catch(() => setList([]))

  useEffect(() => {
    const t = setTimeout(load, q ? 300 : 0)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level, q])

  useEffect(() => {
    if (!auto) return
    const t = setInterval(load, 10_000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, level, q])

  async function copyRecent() {
    const text = (list ?? [])
      .slice(0, 200)
      .reverse()
      .map((l) => `${vnTime(l.ts)} [${l.level.toUpperCase()}] ${l.msg}`)
      .join('\n')
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* trình duyệt chặn clipboard */
    }
  }

  const errors = list?.filter((l) => l.level === 'error').length ?? 0

  return (
    <div className="card">
      <div className="row wrap">
        <h3 className="grow">Nhật ký hệ thống</h3>
        <a className="btn primary sm" href={authUrl('/logs/download?days=1')}>
          <Download size={14} /> Tải hôm nay
        </a>
        <a className="btn outline sm" href={authUrl('/logs/download?days=3')}>
          3 ngày
        </a>
        <a className="btn outline sm" href={authUrl('/logs/download?days=7')}>
          7 ngày
        </a>
      </div>
      <p className="muted small">
        Khi có lỗi: bấm <b>Tải hôm nay</b> rồi gửi file cho người hỗ trợ kỹ thuật. File đã tự che mật khẩu, token và cookie Zalo.
        Lỗi trên trình duyệt của nhân viên cũng được ghi vào đây (dòng bắt đầu bằng [web]).
      </p>
      <div className="row wrap">
        <select className="select sm" value={level} onChange={(e) => setLevel(e.target.value)} aria-label="Mức độ">
          <option value="error">Chỉ lỗi</option>
          <option value="warn">Cảnh báo và lỗi</option>
          <option value="all">Tất cả</option>
        </select>
        <div className="search grow">
          <Search size={14} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm trong nhật ký, VD: zalo#1, Odoo, 503…" />
        </div>
        <label className="check small">
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Tự cập nhật
        </label>
        <button className="btn ghost sm" onClick={load}>
          <RefreshCw size={14} /> Tải lại
        </button>
        <button className="btn ghost sm" onClick={copyRecent} disabled={!list?.length}>
          <Copy size={14} /> {copied ? 'Đã chép' : 'Chép 200 dòng'}
        </button>
      </div>
      {list && (
        <div className="muted small">
          {list.length} dòng gần nhất{errors ? ` · ${errors} lỗi` : ''}
        </div>
      )}
      <div className="log-view">
        {list === null && <div className="muted pad">Đang tải…</div>}
        {list?.length === 0 && <div className="muted pad">Không có dòng nào. Hệ thống đang chạy ổn.</div>}
        {list?.map((l, i) => (
          <div key={i} className={`log-line ${l.level}`}>
            <span className="log-time">{vnTime(l.ts)}</span>
            <span className="log-level">{l.level === 'error' ? 'LỖI' : l.level === 'warn' ? 'CẢNH BÁO' : 'INFO'}</span>
            <span className="log-msg">{l.msg}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
