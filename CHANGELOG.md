# Lịch sử phiên bản

Số phiên bản dạng `LỚN.VỪA.NHỎ`:
- **LỚN**: thay đổi lớn về cách dùng hoặc dữ liệu (ví dụ 1 → 2: chuyển sang nhiều kênh Zalo).
- **VỪA**: thêm tính năng mới.
- **NHỎ**: sửa lỗi, chỉnh giao diện.

Phiên bản đang chạy hiện ở góc trái dưới của app, và ở đầu trang Cài đặt.

## v2.0.0 — 12/10/2026

**Kênh Chat và phân quyền**
- Kết nối nhiều tài khoản Zalo, mỗi tài khoản là một kênh. Tài khoản cũ tự chuyển thành kênh "Zalo chính", không phải quét QR lại.
- Bộ phận: nhân viên chỉ thấy hội thoại, tag, tin nhắn mẫu của bộ phận mình. Quản lý thấy tất cả.
- Cấp thẳng kênh cho từng nhân viên. Bảng phân công nhân viên × kênh để phân công nhiều người cùng lúc.
- Nhân viên tick chọn kênh đang chat (một hoặc nhiều kênh) ở trang Kênh Chat.
- Chuyển hội thoại giữa các bộ phận.

**Chat**
- Gửi sticker (tìm theo từ khóa, có mục dùng gần đây). Sticker khách gửi hiện thành ảnh.
- Menu trên tin nhắn như Zalo PC: trả lời trích dẫn, thả cảm xúc, sao chép, chuyển tiếp, thu hồi, tạo ghi chú.
- Tìm kiếm gộp như Zalo: liên hệ, bạn bè, số điện thoại, nội dung tin nhắn (không phân biệt dấu), bấm vào tin để nhảy tới đúng chỗ.
- Tag có màu chọn từ danh sách. Lọc hội thoại theo kênh, bộ phận, tag.

**Quản lý**
- Menu mới: **Dữ liệu** (báo cáo, chấm điểm, xuất hội thoại để training — chỉ quản lý) và **Cài đặt** (Nhân viên, Bộ phận, Tag, Tin nhắn mẫu, Tích hợp).
- Tag và tin nhắn mẫu xuất/nhập bằng file Excel.
- Đăng nhập bằng tài khoản Odoo (có hỗ trợ mã OTP).
- App tự báo "Đã có phiên bản mới" khi máy chủ vừa cập nhật.

**Sửa lỗi**
- Bấm "Xong" không còn làm hội thoại biến mất khỏi danh sách.

## v1.0.0 — 12/10/2026

- Bản đầu tiên: nhiều nhân viên cùng chat trên 1 tài khoản Zalo cá nhân qua web.
- Nhận / chuyển hội thoại, thấy ai đang xem / đang soạn tin, ghi chú nội bộ, mẫu câu trả lời nhanh.
- Thống kê theo nhân viên, xuất hội thoại TXT / CSV / JSONL / JSON để training.
- API và webhook cho web app khác.
