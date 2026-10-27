import { useEffect, useRef, useState } from 'react'
import { Minus, Plus, Search, Trash2 } from 'lucide-react'
import { api } from '../api'
import { Modal } from '../components'
import type { Conversation } from '../types'

type Product = { id: number; name: string; code: string | null; price: number; stock: number }
type Line = { productId: number; name: string; qty: number; price: number; discount: number; stock: number }
type Status = { enabled: boolean; configs: { id: number; name: string; open: boolean; session: string | null }[]; defaultConfigId: number | null; error?: string }

const money = (n: number) => `${Math.round(n).toLocaleString('vi-VN')}₫`

/** Lên đơn trên POS Odoo từ hội thoại. */
export default function PosOrderModal({ conv, onClose, onDone }: { conv: Conversation; onClose: () => void; onDone: (text: string) => void }) {
  const [status, setStatus] = useState<Status | null>(null)
  const [configId, setConfigId] = useState('')
  const [name, setName] = useState(conv.name ?? '')
  const [phone, setPhone] = useState(conv.phone ?? '')
  const [address, setAddress] = useState('')
  const [note, setNote] = useState('')
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Product[]>([])
  const [searching, setSearching] = useState(false)
  const [lines, setLines] = useState<Line[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => {
    api<Status>('/odoo-pos/status')
      .then((s) => {
        setStatus(s)
        const def = s.configs.find((c) => c.id === s.defaultConfigId) ?? s.configs.find((c) => c.open) ?? s.configs[0]
        if (def) setConfigId(String(def.id))
        if (s.error) setError(s.error)
      })
      .catch((e) => setError(e.message))
  }, [])

  useEffect(() => {
    window.clearTimeout(timer.current)
    if (q.trim().length < 2) {
      setResults([])
      return
    }
    timer.current = window.setTimeout(() => {
      setSearching(true)
      api<Product[]>(`/odoo-pos/products?q=${encodeURIComponent(q.trim())}`)
        .then(setResults)
        .catch((e) => setError(e.message))
        .finally(() => setSearching(false))
    }, 350)
  }, [q])

  const add = (p: Product) => {
    setLines((ls) => {
      const i = ls.findIndex((l) => l.productId === p.id)
      if (i >= 0) return ls.map((l, j) => (j === i ? { ...l, qty: l.qty + 1 } : l))
      return [...ls, { productId: p.id, name: p.name, qty: 1, price: p.price, discount: 0, stock: p.stock }]
    })
    setQ('')
    setResults([])
  }
  const update = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)))
  const total = lines.reduce((s, l) => s + l.price * l.qty * (1 - l.discount / 100), 0)
  const pos = status?.configs.find((c) => String(c.id) === configId)

  async function submit() {
    setBusy(true)
    setError('')
    try {
      const r = await api<{ order: { code: string }; queued: boolean; session: string | null }>(`/conversations/${encodeURIComponent(conv.id)}/pos-orders`, {
        body: { configId: Number(configId), customer: { name, phone, address }, lines, note },
      })
      onDone(r.queued ? `Ca POS chưa mở: đơn ${r.order.code} đang chờ, tự đẩy lên khi mở ca.` : `Đã lên đơn POS ${r.order.code} (${r.session ?? ''}).`)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Lên đơn POS" onClose={onClose} wide>
      {!status ? (
        <div className="muted">Đang tải…</div>
      ) : !status.enabled ? (
        <div className="banner warn inline">Chưa bật lên đơn POS. Quản trị bật ở Cài đặt › Đồng bộ đơn hàng.</div>
      ) : (
        <div className="stack pos-order">
          <div className="grid-2 tight">
            <label className="field">
              <span>Tên khách</span>
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="field">
              <span>Số điện thoại</span>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="Bắt buộc, dùng để tìm khách trên Odoo" />
            </label>
            <label className="field">
              <span>Địa chỉ giao hàng</span>
              <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Nếu giao hàng" />
            </label>
            <label className="field">
              <span>Điểm bán POS</span>
              <select className="select" value={configId} onChange={(e) => setConfigId(e.target.value)}>
                {status.configs.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} {c.open ? '· đang mở ca' : '· chưa mở ca'}
                  </option>
                ))}
              </select>
              {pos && !pos.open && <span className="small warn-text">Ca chưa mở: đơn sẽ chờ trong app và tự đẩy lên khi thu ngân mở ca.</span>}
            </label>
          </div>

          <div className="field">
            <span>Sản phẩm</span>
            <label className="search-box">
              <Search size={16} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm theo tên, mã sản phẩm, mã vạch" aria-label="Tìm sản phẩm" />
            </label>
            {searching && <span className="small muted">Đang tìm…</span>}
            {results.length > 0 && (
              <div className="product-results">
                {results.map((p) => (
                  <button key={p.id} type="button" onClick={() => add(p)}>
                    <span className="grow">{p.name}</span>
                    <span className={`small ${p.stock > 0 ? 'muted' : 'err-text'}`}>tồn {p.stock}</span>
                    <b>{money(p.price)}</b>
                  </button>
                ))}
              </div>
            )}
          </div>

          {lines.length > 0 && (
            <div className="table-wrap">
              <table className="table pos-lines">
                <thead>
                  <tr>
                    <th>Sản phẩm</th>
                    <th>SL</th>
                    <th>Đơn giá</th>
                    <th>CK %</th>
                    <th>Thành tiền</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={l.productId}>
                      <td>
                        {l.name}
                        {l.qty > l.stock && <div className="small err-text">Tồn kho {l.stock}</div>}
                      </td>
                      <td>
                        <span className="qty">
                          <button type="button" className="icon-btn sm" onClick={() => update(i, { qty: Math.max(1, l.qty - 1) })} aria-label="Giảm">
                            <Minus size={14} />
                          </button>
                          {l.qty}
                          <button type="button" className="icon-btn sm" onClick={() => update(i, { qty: l.qty + 1 })} aria-label="Tăng">
                            <Plus size={14} />
                          </button>
                        </span>
                      </td>
                      <td>
                        <input className="num" type="number" min={0} value={l.price} onChange={(e) => update(i, { price: Number(e.target.value) })} />
                      </td>
                      <td>
                        <input className="num sm" type="number" min={0} max={100} value={l.discount} onChange={(e) => update(i, { discount: Math.min(100, Math.max(0, Number(e.target.value))) })} />
                      </td>
                      <td>{money(l.price * l.qty * (1 - l.discount / 100))}</td>
                      <td>
                        <button type="button" className="icon-btn sm" onClick={() => setLines(lines.filter((_, j) => j !== i))} aria-label="Bỏ sản phẩm">
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <label className="field">
            <span>Ghi chú cho thu ngân / kho</span>
            <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          {error && <div className="form-error">{error}</div>}
          <div className="row">
            <span className="grow">
              Tổng (đã gồm thuế): <b className="pos-total">{money(total)}</b>
            </span>
            <button className="btn ghost" onClick={onClose}>
              Hủy
            </button>
            <button className="btn primary" disabled={busy || !lines.length || !phone.trim() || !configId} onClick={submit}>
              {busy ? 'Đang lên đơn…' : 'Lên đơn POS'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
