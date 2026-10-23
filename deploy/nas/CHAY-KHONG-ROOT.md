# Cho app chạy không cần quyền quản trị (root) trên NAS

**Vì sao:** hiện app chạy trong container bằng tài khoản `root`. Nếu một ngày app (hoặc thư viện nó dùng) có lỗ hổng bị khai thác, kẻ tấn công có quyền cao nhất trên thư mục dữ liệu và dễ leo thang ra NAS hơn. Sau khi đổi, app chạy bằng người dùng thường **uid 1000**, bị bỏ hết đặc quyền (`cap_drop: ALL`, `no-new-privileges`) — chỉ ghi được vào thư mục `data` của chính nó.

**Ảnh hưởng:** app ngừng khoảng **30 giây** lúc đổi. Làm ngoài giờ. Dữ liệu giữ nguyên.

Thư mục dự án dưới đây là `/volume2/Chat Sieu Toc/VPS Chat Sieu Toc` — sửa lại nếu của anh khác (File Station › chuột phải thư mục › Thuộc tính › Vị trí).

---

## Các bước (khoảng 10 phút)

**1. Tắt tạm tác vụ tự cập nhật**
Bảng điều khiển › Bộ lập lịch tác vụ › bỏ tick ô **Đã bật** ở dòng *Cap nhat Chat Sieu Toc* › Lưu.

**2. Tạo tác vụ đổi chủ thư mục `data` sang uid 1000**
Bộ lập lịch tác vụ › **Tạo** › **Tác vụ đã lên lịch** › **Tập lệnh do người dùng xác định**
- Thẻ *Chung*: Tác vụ `Doi chu thu muc chat`, Người dùng **root**, **bỏ tick Đã bật** (chỉ chạy tay).
- Thẻ *Cài đặt tác vụ* › Tập lệnh:
  ```
  chown -R 1000:1000 "/volume2/Chat Sieu Toc/VPS Chat Sieu Toc/data"
  ```
- OK. Chọn tác vụ vừa tạo › **Chạy**. (App vẫn chạy bình thường, chưa ngừng.)

**3. Thay file cấu hình**
File Station › `Chat Sieu Toc › VPS Chat Sieu Toc`:
- Đổi tên `docker-compose.yml` hiện tại thành `docker-compose.yml.cu` (để quay lại nếu cần).
- Tải lên file `docker-compose.yml` mới (có thêm dòng `user: "1000:1000"`).
- Tải lên đè file `cap-nhat.sh` mới (dựng lại container sạch khi cấu hình đổi, không để Container Manager báo đỏ).

**4. Bật lại tác vụ tự cập nhật và chạy ngay**
Bộ lập lịch tác vụ › tick lại **Đã bật** ở *Cap nhat Chat Sieu Toc* › Lưu › chọn dòng đó › **Chạy**.
Tác vụ thấy cấu hình đổi nên dựng lại 3 container (app ngừng khoảng 30 giây).

**5. Chạy lại tác vụ đổi chủ một lần nữa**
Chọn *Doi chu thu muc chat* › **Chạy** — để chắc các file app tạo trong lúc đổi cũng thuộc uid 1000.

**6. Kiểm tra**
- Mở `https://cskhzalo.sieutoc.com`, đăng nhập, xem Zalo vẫn kết nối.
- Container Manager › Container › `chat-sieutoc` › **Nhật ký**: không có dòng `EACCES` / `permission denied`.
- Hoặc nhắn Claude kiểm tra giúp (đọc nhật ký từ xa).

---

## Nếu có lỗi — quay lại như cũ (1 phút)
1. File Station: xóa `docker-compose.yml` mới, đổi tên `docker-compose.yml.cu` về lại `docker-compose.yml`.
2. Bộ lập lịch tác vụ › *Cap nhat Chat Sieu Toc* › **Chạy**. App chạy lại bằng root như trước (root vẫn đọc ghi được thư mục đã đổi chủ, không cần đổi lại).

## Ghi chú
- Từ nay khôi phục dữ liệu (chép bản sao lưu đè lên `data/app.db`) xong thì chạy lại tác vụ *Doi chu thu muc chat* trước khi bật app.
- Container `chat-sieutoc-tunnel` (Cloudflare) vốn đã chạy bằng người dùng thường; chỉ thêm bỏ đặc quyền.
