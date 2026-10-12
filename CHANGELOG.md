# Lịch sử phiên bản

Số phiên bản dạng `LỚN.VỪA.NHỎ`:
- **LỚN**: thay đổi lớn về cách dùng hoặc dữ liệu (ví dụ 1 → 2: chuyển sang nhiều kênh Zalo).
- **VỪA**: thêm tính năng mới.
- **NHỎ**: sửa lỗi, chỉnh giao diện.

Phiên bản đang chạy hiện ở góc trái dưới của app, và ở đầu trang Cài đặt.

## v2.2.0 — 12/10/2026

**Phân quyền theo từng người và theo nhóm**
- Tab mới **Cài đặt › Phân quyền**: tạo nhóm quyền (ví dụ Trưởng ca, Kế toán), tick quyền cho nhóm, chọn thành viên.
- 14 quyền chi tiết: xem tất cả hội thoại, giao/chuyển hội thoại, thu hồi tin của người khác, chấm điểm, xem dữ liệu, xuất dữ liệu, quản lý kênh, nhân viên, bộ phận, tag, tin nhắn mẫu, tích hợp, nhật ký, phân quyền.
- Mỗi nhân viên có quyền = quyền của các nhóm họ thuộc về + **quyền riêng** cấp thêm (sửa ở tab Nhân viên).
- Có sẵn 3 nhóm mẫu: Quản trị, Trưởng nhóm, Nhân viên CSKH. Quản trị viên cũ tự vào nhóm "Quản trị".
- Không ai cấp được quyền mà chính mình không có; chỉ Super Admin cấp được Super Admin.
- Menu và các tab Cài đặt chỉ hiện theo quyền của từng người.

**Tag**
- Ô **Tìm tag** luôn hiện (trước đây chỉ hiện khi có trên 6 tag).

## v2.1.1 — 12/10/2026

**Sửa lỗi**
- Trang Cài đặt mất thanh tab (Nhân viên, Bộ phận, Tag, Tin nhắn mẫu, Tích hợp, Nhật ký) khi nội dung tab dài hơn màn hình, ví dụ tab Tích hợp: trình duyệt co thanh tab về 0 chiều cao. Giờ thanh tab luôn hiện.

## v2.1.0 — 12/10/2026

**Sửa lỗi**
- Đổi tên kênh (hoặc lưu cài đặt kênh) làm Zalo bị đá ra liên tục: app mở thêm một phiên Zalo song song với phiên đang chạy. Giờ chỉ đăng nhập lại khi thật sự bật lại kênh, và không bao giờ chạy 2 phiên cho 1 kênh.

**Mới**
- Quyền **Super Admin** (cao nhất), cấp cho `hau.vn@sieutoc.com`. Chỉ Super Admin mới cấp / sửa / khóa tài khoản quản trị, xem Nhật ký, quản lý Tích hợp và xóa kênh.
- **Cài đặt › Nhật ký**: xem lỗi và cảnh báo của hệ thống, tìm trong nhật ký, tải file nhật ký (hôm nay / 3 ngày / 7 ngày) để gửi kiểm tra lỗi. File tự che mật khẩu, token, cookie Zalo. Lỗi trên trình duyệt của nhân viên cũng tự gửi về đây.
- **Tag hiện sẵn để bấm**: trong khung Thông tin khách, toàn bộ tag hiện thành nút, bấm để gắn / bỏ, có ô tìm tag. Danh sách hội thoại có hàng tag để lọc nhanh.

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
