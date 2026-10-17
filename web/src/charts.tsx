/**
 * Biểu đồ nhẹ cho mục Báo cáo (SVG / CSS thuần, không thư viện): đường, cột, thanh ngang, bản đồ nhiệt giờ, vành khuyên.
 * Tự co theo bề ngang khung; rê chuột / chạm để xem số của từng ngày.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

export const CHART_COLORS = ['#0a804a', '#97c354', '#2563c9', '#e0900a', '#7c5cc4', '#d83a2f', '#0f9557', '#55655c']

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [w, setW] = useState(600)
  useLayoutEffect(() => {
    if (!ref.current) return
    setW(ref.current.clientWidth || 600)
    const ro = new ResizeObserver(([e]) => setW(Math.max(200, Math.round(e.contentRect.width))))
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}

/** Mốc trục tung "đẹp": 0, 5, 10… */
function niceMax(v: number) {
  if (v <= 0) return 4
  const p = Math.pow(10, Math.floor(Math.log10(v)))
  const n = v / p
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10
  return step * p
}
const short = (n: number) => (n >= 1e9 ? `${+(n / 1e9).toFixed(1)}tỷ` : n >= 1e6 ? `${+(n / 1e6).toFixed(1)}tr` : n >= 1e4 ? `${+(n / 1e3).toFixed(0)}k` : String(Math.round(n * 10) / 10))
export const dayLabelShort = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`
/** Nhãn trục ngày: cách đều, luôn có ngày cuối, bỏ nhãn quá sát ngày cuối để không chồng chữ. */
const showLabel = (i: number, n: number, every: number) => i === n - 1 || (i % every === 0 && n - 1 - i >= every * 0.6)

export type Series = { label: string; color: string; values: (number | null)[]; area?: boolean; dashed?: boolean }

type TipRow = { label: string; color: string; value: string }
function Tip({ x, title, rows, width }: { x: number; title: string; rows: TipRow[]; width: number }) {
  const left = Math.min(Math.max(x - 80, 0), width - 170)
  return (
    <div className="chart-tip" style={{ left }}>
      <b>{title}</b>
      {rows.map((r) => (
        <span key={r.label}>
          <i style={{ background: r.color }} /> {r.label}: <b>{r.value}</b>
        </span>
      ))}
    </div>
  )
}

export function Legend({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
  return (
    <div className="chart-legend">
      {items.map((i) => (
        <span key={i.label}>
          <i className={i.dashed ? 'dashed' : ''} style={{ background: i.dashed ? 'transparent' : i.color, borderColor: i.color }} /> {i.label}
        </span>
      ))}
    </div>
  )
}

/** Biểu đồ đường theo ngày (nhiều đường, đường đầu có nền). */
export function LineChart({ labels, series, height = 220, format = short, empty = 'Chưa có số liệu' }: { labels: string[]; series: Series[]; height?: number; format?: (n: number) => string; empty?: string }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const pad = { l: 40, r: 12, t: 12, b: 26 }
  const all = series.flatMap((s) => s.values.filter((v): v is number => v != null))
  const max = niceMax(Math.max(0, ...all))
  const iw = width - pad.l - pad.r
  const ih = height - pad.t - pad.b
  const n = labels.length
  const x = (i: number) => pad.l + (n <= 1 ? iw / 2 : (i * iw) / (n - 1))
  const y = (v: number) => pad.t + ih - (v / max) * ih
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 56))))
  const hasData = all.some((v) => v > 0)
  return (
    <div className="chart" ref={ref}>
      <svg width={width} height={height} role="img" aria-label={series.map((s) => s.label).join(', ')}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect()
          const i = n <= 1 ? 0 : Math.round(((e.clientX - r.left - pad.l) / iw) * (n - 1))
          setHover(Math.min(n - 1, Math.max(0, i)))
        }}
        onTouchStart={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect()
          const i = n <= 1 ? 0 : Math.round(((e.touches[0].clientX - r.left - pad.l) / iw) * (n - 1))
          setHover(Math.min(n - 1, Math.max(0, i)))
        }}
      >
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <g key={f}>
            <line x1={pad.l} x2={width - pad.r} y1={y(max * f)} y2={y(max * f)} className="chart-grid" />
            <text x={pad.l - 6} y={y(max * f) + 4} textAnchor="end" className="chart-axis">
              {format(max * f)}
            </text>
          </g>
        ))}
        {labels.map((l, i) =>
          showLabel(i, n, every) ? (
            <text key={l} x={x(i)} y={height - 8} textAnchor="middle" className="chart-axis">
              {dayLabelShort(l)}
            </text>
          ) : null,
        )}
        {series.map((s) => {
          const pts = s.values.map((v, i) => (v == null ? null : [x(i), y(v)] as const))
          const d = pts.reduce((acc, p, i) => (p ? acc + `${acc && pts[i - 1] ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}` : acc), '')
          const first = pts.findIndex(Boolean)
          let lastIdx = -1
          pts.forEach((p, i) => p && (lastIdx = i))
          return (
            <g key={s.label}>
              {s.area && first >= 0 && <path d={`${d}L${x(lastIdx)},${y(0)}L${x(first)},${y(0)}Z`} fill={s.color} opacity={0.12} />}
              <path d={d} fill="none" stroke={s.color} strokeWidth={2} strokeDasharray={s.dashed ? '5 4' : undefined} strokeLinejoin="round" />
              {(n <= 31 || hover != null) &&
                pts.map((p, i) => p && (n <= 31 || i === hover) ? <circle key={i} cx={p[0]} cy={p[1]} r={i === hover ? 4.5 : 2.5} fill={s.color} /> : null)}
            </g>
          )
        })}
        {hover != null && <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + ih} className="chart-cursor" />}
        {!hasData && (
          <text x={width / 2} y={height / 2} textAnchor="middle" className="chart-empty">
            {empty}
          </text>
        )}
      </svg>
      {hover != null && hasData && (
        <Tip x={x(hover)} width={width} title={labels[hover].split('-').reverse().join('/')} rows={series.map((s) => ({ label: s.label, color: s.color, value: s.values[hover] == null ? '–' : format(s.values[hover]!) }))} />
      )}
    </div>
  )
}

/** Biểu đồ cột theo ngày (chồng nhiều loại). */
export function BarChart({ labels, series, height = 200, format = short, empty = 'Chưa có số liệu' }: { labels: string[]; series: Series[]; height?: number; format?: (n: number) => string; empty?: string }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const pad = { l: 40, r: 12, t: 12, b: 26 }
  const n = labels.length
  const totals = labels.map((_, i) => series.reduce((s, se) => s + (se.values[i] ?? 0), 0))
  const max = niceMax(Math.max(0, ...totals))
  const iw = width - pad.l - pad.r
  const ih = height - pad.t - pad.b
  const slot = iw / Math.max(1, n)
  const bw = Math.max(2, Math.min(36, slot * 0.68))
  const y = (v: number) => pad.t + ih - (v / max) * ih
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 56))))
  const hasData = totals.some((v) => v > 0)
  return (
    <div className="chart" ref={ref}>
      <svg width={width} height={height} role="img" aria-label={series.map((s) => s.label).join(', ')} onMouseLeave={() => setHover(null)}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={pad.l} x2={width - pad.r} y1={y(max * f)} y2={y(max * f)} className="chart-grid" />
            <text x={pad.l - 6} y={y(max * f) + 4} textAnchor="end" className="chart-axis">
              {format(max * f)}
            </text>
          </g>
        ))}
        {labels.map((l, i) => {
          let acc = 0
          const cx = pad.l + slot * i + slot / 2
          return (
            <g key={l} onMouseEnter={() => setHover(i)} onTouchStart={() => setHover(i)}>
              <rect x={pad.l + slot * i} y={pad.t} width={slot} height={ih} fill="transparent" />
              {series.map((s) => {
                const v = s.values[i] ?? 0
                if (!v) return null
                const top = y(acc + v)
                const h = y(acc) - top
                acc += v
                return <rect key={s.label} x={cx - bw / 2} y={top} width={bw} height={Math.max(1, h)} fill={s.color} rx={2} opacity={hover == null || hover === i ? 1 : 0.55} />
              })}
              {showLabel(i, n, every) && (
                <text x={cx} y={height - 8} textAnchor="middle" className="chart-axis">
                  {dayLabelShort(l)}
                </text>
              )}
            </g>
          )
        })}
        {!hasData && (
          <text x={width / 2} y={height / 2} textAnchor="middle" className="chart-empty">
            {empty}
          </text>
        )}
      </svg>
      {hover != null && hasData && (
        <Tip x={pad.l + slot * hover + slot / 2} width={width} title={labels[hover].split('-').reverse().join('/')} rows={series.map((s) => ({ label: s.label, color: s.color, value: format(s.values[hover] ?? 0) }))} />
      )}
    </div>
  )
}

/** Danh sách thanh ngang (xếp hạng): theo kênh, tag, nhân viên… */
export function HBars({ items, format = (n: number) => n.toLocaleString('vi-VN'), empty = 'Chưa có số liệu' }: { items: { label: ReactNode; value: number; color?: string; sub?: ReactNode }[]; format?: (n: number) => string; empty?: string }) {
  const max = Math.max(1, ...items.map((i) => i.value))
  if (!items.length) return <div className="muted small pad">{empty}</div>
  return (
    <div className="hbars">
      {items.map((i, k) => (
        <div key={k} className="hbar">
          <div className="hbar-head">
            <span className="hbar-label">{i.label}</span>
            <b>{format(i.value)}</b>
          </div>
          <div className="hbar-track">
            <div className="hbar-fill" style={{ width: `${(i.value / max) * 100}%`, background: i.color ?? CHART_COLORS[0] }} />
          </div>
          {i.sub && <span className="small muted">{i.sub}</span>}
        </div>
      ))}
    </div>
  )
}

const DOW = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']
/** Bản đồ nhiệt: khách nhắn theo thứ × giờ (giờ cao điểm để xếp ca). */
export function Heatmap({ data }: { data: number[][] }) {
  const max = Math.max(1, ...data.flat())
  const [tip, setTip] = useState<string | null>(null)
  const order = [1, 2, 3, 4, 5, 6, 0]
  return (
    <div className="heat">
      <div className="heat-grid">
        <span />
        {Array.from({ length: 24 }, (_, h) => (
          <span key={h} className="heat-h">
            {h % 3 === 0 ? h : ''}
          </span>
        ))}
        {order.map((d) => (
          <FragmentRow key={d} label={DOW[d]}>
            {data[d].map((v, h) => (
              <span
                key={h}
                className="heat-cell"
                style={{ opacity: v ? 0.15 + 0.85 * (v / max) : 1, background: v ? 'var(--mz-green-700)' : 'var(--mz-ink-100)' }}
                onMouseEnter={() => setTip(`${DOW[d]} ${h}:00–${h + 1}:00 · ${v} tin khách`)}
                onTouchStart={() => setTip(`${DOW[d]} ${h}:00–${h + 1}:00 · ${v} tin khách`)}
                aria-label={`${DOW[d]} ${h} giờ: ${v} tin`}
              />
            ))}
          </FragmentRow>
        ))}
      </div>
      <div className="small muted heat-tip">{tip ?? 'Rê chuột / chạm vào ô để xem số tin. Ô đậm = khách nhắn nhiều.'}</div>
    </div>
  )
}
function FragmentRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <span className="heat-d">{label}</span>
      {children}
    </>
  )
}

/** Vành khuyên + chú thích. */
export function Donut({ items, center }: { items: { label: string; value: number; color: string }[]; center?: ReactNode }) {
  const total = items.reduce((s, i) => s + i.value, 0)
  const r = 52
  const c = 2 * Math.PI * r
  let off = 0
  const [hover, setHover] = useState<number | null>(null)
  useEffect(() => setHover(null), [total])
  return (
    <div className="donut">
      <svg width={140} height={140} viewBox="0 0 140 140" role="img" aria-label={items.map((i) => `${i.label} ${i.value}`).join(', ')}>
        <circle cx={70} cy={70} r={r} fill="none" stroke="var(--mz-ink-100)" strokeWidth={18} />
        {total > 0 &&
          items.map((i, k) => {
            const len = (i.value / total) * c
            const el = (
              <circle
                key={i.label}
                cx={70}
                cy={70}
                r={r}
                fill="none"
                stroke={i.color}
                strokeWidth={hover === k ? 22 : 18}
                strokeDasharray={`${len} ${c - len}`}
                strokeDashoffset={-off}
                transform="rotate(-90 70 70)"
                onMouseEnter={() => setHover(k)}
                onMouseLeave={() => setHover(null)}
              />
            )
            off += len
            return el
          })}
        <text x={70} y={68} textAnchor="middle" className="donut-num">
          {hover != null ? items[hover].value : total}
        </text>
        <text x={70} y={86} textAnchor="middle" className="chart-axis">
          {hover != null ? items[hover].label : center ?? 'tổng'}
        </text>
      </svg>
      <div className="chart-legend col">
        {items.map((i) => (
          <span key={i.label}>
            <i style={{ background: i.color }} /> {i.label} <b>{i.value}</b>
            {total > 0 && <span className="muted"> · {Math.round((i.value / total) * 100)}%</span>}
          </span>
        ))}
      </div>
    </div>
  )
}
