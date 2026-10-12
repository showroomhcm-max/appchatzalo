import { useState } from 'react'
import { AlertTriangle, CheckCircle2, LogOut, QrCode, RefreshCw, Smartphone } from 'lucide-react'
import { api } from '../api'
import { useApp } from '../store'
import { Avatar, PublicLink } from '../components'

export default function ZaloConnect() {
  const { zalo } = useApp()
  const [busy, setBusy] = useState(false)

  async function call(path: string, confirmText?: string) {
    if (confirmText && !confirm(confirmText)) return
    setBusy(true)
    try {
      await api(path, { method: 'POST' })
    } catch (e: any) {
      alert(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page narrow">
      <div className="page-head">
        <div>
          <h1>Kết nối Zalo</h1>
          <p className="muted">
            Liên kết một tài khoản Zalo cá nhân. Sau khi kết nối, cả đội cùng nhận và trả lời tin nhắn trên web này.
          </p>
        </div>
      </div>

      <div className="card zalo-card">
        {zalo.state === 'connected' && zalo.account && (
          <div className="zalo-connected">
            <Avatar name={zalo.account.name} src={zalo.account.avatar} size={72} />
            <div>
              <div className="row">
                <CheckCircle2 size={20} className="ok-icon" />
                <b>Đã kết nối</b>
              </div>
              <div className="zalo-name">{zalo.account.name}</div>
              <code className="muted small">ID: {zalo.account.id}</code>
            </div>
            <div className="row end grow">
              <button className="btn outline" disabled={busy} onClick={() => call('/zalo/reconnect')}>
                <RefreshCw size={16} /> Kết nối lại
              </button>
              <button
                className="btn danger"
                disabled={busy}
                onClick={() =>
                  call('/zalo/logout', 'Ngắt kết nối Zalo? Toàn bộ nhân viên sẽ không nhận/gửi được tin cho tới khi quét QR lại.')
                }
              >
                <LogOut size={16} /> Ngắt kết nối
              </button>
            </div>
          </div>
        )}

        {(zalo.state === 'qr' || zalo.state === 'scanned') && (
          <div className="qr-box">
            {zalo.state === 'qr' && zalo.qrImage && <img src={zalo.qrImage} alt="Mã QR đăng nhập Zalo" className="qr" />}
            {zalo.state === 'scanned' && (
              <div className="scanned">
                <Avatar name={zalo.scannedBy?.name} src={zalo.scannedBy?.avatar} size={96} />
                <b>{zalo.scannedBy?.name}</b>
                <span className="muted">Đã quét — hãy bấm xác nhận đăng nhập trên điện thoại</span>
              </div>
            )}
            <ol className="steps">
              <li>Mở ứng dụng Zalo trên điện thoại của tài khoản cần dùng.</li>
              <li>
                Bấm biểu tượng <b>QR</b> ở thanh tìm kiếm.
              </li>
              <li>Quét mã bên cạnh và bấm Đăng nhập.</li>
            </ol>
            <button className="btn ghost" onClick={() => call('/zalo/cancel')}>
              Hủy
            </button>
          </div>
        )}

        {zalo.state === 'connecting' && (
          <div className="center pad">
            <RefreshCw size={28} className="spin" />
            <div>Đang kết nối tới Zalo…</div>
          </div>
        )}

        {(zalo.state === 'disconnected' || zalo.state === 'error') && (
          <div className="center pad stack">
            {zalo.error && (
              <div className="banner warn inline">
                <AlertTriangle size={16} /> {zalo.error}
              </div>
            )}
            <QrCode size={48} className="muted" />
            <div>Chưa có tài khoản Zalo nào được kết nối.</div>
            <div className="row">
              <button className="btn primary" disabled={busy} onClick={() => call('/zalo/login-qr')}>
                <QrCode size={18} /> Tạo mã QR đăng nhập
              </button>
              {zalo.state === 'error' && (
                <button className="btn outline" disabled={busy} onClick={() => call('/zalo/reconnect')}>
                  <RefreshCw size={16} /> Thử dùng phiên đã lưu
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <PublicLink />
      <div className="card notice">
        <h3>
          <Smartphone size={18} /> Lưu ý khi dùng Zalo cá nhân
        </h3>
        <ul>
          <li>
            Zalo chỉ cho <b>một phiên web</b> hoạt động một lúc. Đừng mở chat.zalo.me hoặc Zalo PC bằng tài khoản này, vì máy
            chủ sẽ bị ngắt. Ứng dụng trên điện thoại vẫn dùng bình thường.
          </li>
          <li>
            Kết nối dùng thư viện không chính thức (zca-js). Zalo có thể khóa tài khoản nếu gửi hàng loạt hoặc spam. Chỉ dùng
            để trả lời khách, tránh gửi tin hàng loạt cho người lạ.
          </li>
          <li>Tin nhắn gửi trực tiếp từ điện thoại vẫn được lưu nhưng ghi là "Gửi từ điện thoại", không gắn tên nhân viên.</li>
          <li>
            Khi mới kết nối, hệ thống chỉ đồng bộ được các tin gần đây. Lịch sử đầy đủ sẽ được lưu từ thời điểm kết nối trở đi.
          </li>
        </ul>
      </div>
    </div>
  )
}
