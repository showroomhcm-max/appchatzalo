import { useEffect, useState } from 'react'
import { ExternalLink, RefreshCw, Wrench } from 'lucide-react'
import { api, safeUrl } from '../api'
import { Badge } from '../components'
import type { Conversation } from '../types'

type Ticket = { id: number; name: string; order: string; status: 'DANG_THUC_HIEN' | 'XONG' | 'HUY'; technician: string; services: string[]; start: string | null; end: string | null; updated: string | null }
type Helpdesk = { id: number; ref: string; name: string; kind: 'delivery' | 'support' | 'other'; team: string; stage: string; done: boolean; user: string; created: string | null; closed: string | null }
type Warranty = { id: number; no: string; product: string; serial: string; issue: string; stage: string; tech: string; created: string | null; due: string }
type Summary = { phone: string; dvkt: Ticket[]; helpdesk: Helpdesk[]; warranty: Warranty[]; errors: Record<string, string>; links: Record<string, string> }
type Resp = { enabled: boolean; phone?: string | null; data?: Summary | null; error?: string }

const TICKET_STATUS: Record<Ticket['status'], { label: string; tone: string }> = {
  DANG_THUC_HIEN: { label: 'Đang làm', tone: 'info' },
  XONG: { label: 'Xong', tone: 'green' },
  HUY: { label: 'Hủy', tone: 'neutral' },
}
const KIND_LABEL: Record<Helpdesk['kind'], string> = { delivery: 'Giao hàng', support: 'Hỗ trợ KT', other: 'Helpdesk' }

const day = (s: string | null) => (s ? new Date(s).toLocaleDateString('vi-VN') : '')

/** Khung Thông tin › Kỹ thuật: vé DVKT, đơn giao hàng / hỗ trợ kỹ thuật, bảo hành của khách (app DVKT, chỉ đọc). */
export default function DvktPanel({ conv }: { conv: Conversation }) {
  const [resp, setResp] = useState<Resp | null>(null)
  const [loading, setLoading] = useState(false)
  const [showAll, setShowAll] = useState(false)

  const load = (refresh = false) => {
    setLoading(true)
    api<Resp>(`/conversations/${encodeURIComponent(conv.id)}/dvkt${refresh ? '?refresh=1' : ''}`)
      .then(setResp)
      .catch((e) => setResp({ enabled: true, error: e.message }))
      .finally(() => setLoading(false))
  }
  useEffect(() => {
    setResp(null)
    setShowAll(false)
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conv.id, conv.phone])

  // Chưa bật kết nối thì không chiếm chỗ trong khung Thông tin
  if (!resp || !resp.enabled) return null
  const d = resp.data
  const open = (d?.dvkt.filter((t) => t.status === 'DANG_THUC_HIEN').length ?? 0) + (d?.helpdesk.filter((h) => !h.done).length ?? 0)
  const total = d ? d.dvkt.length + d.helpdesk.length + d.warranty.length : 0
  // Mặc định: việc đang mở + 3 việc gần nhất mỗi loại
  const limit = showAll ? 99 : 3
  const link = (base: string | undefined, id?: number) => safeUrl(base ? `${base}${id ?? ''}` : '')

  return (
    <div className="info-section dvkt-panel">
      <div className="section-title row">
        <span className="grow">
          <Wrench size={14} /> Kỹ thuật (DVKT)
        </span>
        {open > 0 && <Badge tone="info">{open} đang xử lý</Badge>}
        <button className="icon-btn sm" onClick={() => load(true)} disabled={loading} aria-label="Tải lại từ app DVKT" title="Tải lại">
          <RefreshCw size={14} className={loading ? 'spin' : ''} />
        </button>
      </div>
      {!resp.phone && <span className="muted small">Chưa có số điện thoại của khách. Khách gửi số trong tin nhắn hoặc lưu số cho hội thoại thì app tự tra.</span>}
      {resp.error && <span className="small err-text">{resp.error}</span>}
      {d && (
        <>
          <span className="muted small">
            SĐT {d.phone}
            {total === 0 ? ' · chưa có vé, đơn giao hàng hay phiếu bảo hành nào' : ''}
          </span>
          {Object.values(d.errors).length > 0 && <span className="small err-text">Một phần dữ liệu chưa đọc được: {Object.values(d.errors)[0]}</span>}

          {d.dvkt.slice(0, limit).map((t) => (
            <div key={`t${t.id}`} className="dvkt-item">
              <div className="row">
                <span className="dvkt-kind">Vé DVKT</span>
                <b className="grow ellipsis">{t.order || t.name}</b>
                <Badge tone={TICKET_STATUS[t.status].tone}>{TICKET_STATUS[t.status].label}</Badge>
              </div>
              <span className="small muted">
                {[t.technician && `KTV ${t.technician}`, t.services.join(', '), t.end ? `xong ${day(t.end)}` : t.start && `bắt đầu ${day(t.start)}`].filter(Boolean).join(' · ')}
              </span>
              <span className="dvkt-links small">
                <a href={link(d.links.dvkt)} target="_blank" rel="noopener noreferrer">
                  Mở app DVKT <ExternalLink size={12} />
                </a>
                <a href={link(d.links.odoo_dvkt, t.id)} target="_blank" rel="noopener noreferrer">
                  Odoo <ExternalLink size={12} />
                </a>
              </span>
            </div>
          ))}

          {d.helpdesk.slice(0, limit).map((h) => (
            <div key={`h${h.id}`} className="dvkt-item">
              <div className="row">
                <span className="dvkt-kind">{KIND_LABEL[h.kind]}</span>
                <b className="grow ellipsis">{h.name || `#${h.ref || h.id}`}</b>
                <Badge tone={h.done ? 'green' : 'warning'}>{h.stage || (h.done ? 'Xong' : 'Đang xử lý')}</Badge>
              </div>
              <span className="small muted">{[h.ref && `#${h.ref}`, h.user && `KTV ${h.user}`, h.created && `tạo ${day(h.created)}`].filter(Boolean).join(' · ')}</span>
              <span className="dvkt-links small">
                <a href={link(h.kind === 'support' ? d.links.support : d.links.delivery)} target="_blank" rel="noopener noreferrer">
                  Mở app DVKT <ExternalLink size={12} />
                </a>
                <a href={link(d.links.odoo_helpdesk, h.id)} target="_blank" rel="noopener noreferrer">
                  Odoo <ExternalLink size={12} />
                </a>
              </span>
            </div>
          ))}

          {d.warranty.slice(0, limit).map((w) => (
            <div key={`w${w.id}`} className="dvkt-item">
              <div className="row">
                <span className="dvkt-kind">Bảo hành</span>
                <b className="grow ellipsis">{w.product || w.no}</b>
                {w.stage && <Badge tone="lime">{w.stage}</Badge>}
              </div>
              <span className="small muted">
                {[w.no, w.serial && `S/N ${w.serial}`, w.tech && `KTV ${w.tech}`, w.due && `hẹn ${new Date(w.due).toLocaleDateString('vi-VN')}`].filter(Boolean).join(' · ')}
              </span>
              {w.issue && <span className="small dvkt-issue">{w.issue}</span>}
              <span className="dvkt-links small">
                <a href={link(d.links.warranty)} target="_blank" rel="noopener noreferrer">
                  Mở app DVKT <ExternalLink size={12} />
                </a>
                <a href={link(d.links.odoo_warranty, w.id)} target="_blank" rel="noopener noreferrer">
                  Odoo <ExternalLink size={12} />
                </a>
              </span>
            </div>
          ))}

          {!showAll && (d.dvkt.length > 3 || d.helpdesk.length > 3 || d.warranty.length > 3) && (
            <button className="btn ghost sm" onClick={() => setShowAll(true)}>
              Xem tất cả ({total})
            </button>
          )}
        </>
      )}
    </div>
  )
}
