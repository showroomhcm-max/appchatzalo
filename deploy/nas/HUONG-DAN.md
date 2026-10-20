# Chạy Chat Siêu Tốc trên Synology DS923+

DS923+ (AMD Ryzen R1600, 8 GB RAM) dư sức cho 20 nhân viên / 30 thiết bị. App chạy trong 2 container:

| Container | Việc |
|---|---|
| `chat-sieutoc` | App chat (giao diện + máy chủ + kết nối Zalo) |
| `chat-sieutoc-tunnel` | Cloudflare Tunnel đưa app ra `https://cskhzalo.sieutoc.com` |

Không mở cổng nào trên router. Tên miền giữ nguyên, không phải sửa gì trên Cloudflare.

> **Quan trọng:** Zalo chỉ cho **một nơi** nhận tin cho mỗi tài khoản. Không bao giờ để app chạy cùng lúc ở laptop và NAS — nơi chạy sau sẽ đá nơi chạy trước, và hai nơi sẽ có dữ liệu lệch nhau.

---

## A. Chuẩn bị NAS (làm trước lúc nào cũng được, không ảnh hưởng app đang chạy)

1. **Cài Container Manager**: Trung tâm gói → tìm *Container Manager* → Cài đặt. (Cần DSM 7.2 trở lên.)
2. **Không cho ổ cứng ngủ**: Bảng điều khiển → Phần cứng & Nguồn → *Ngủ đông ổ cứng* → chọn *Không bao giờ* cho ổ chứa thư mục `docker`.
3. **Tự bật lại khi có điện**: Bảng điều khiển → Phần cứng & Nguồn → Chung → bật *Khởi động lại tự động sau khi mất điện*.
4. **UPS** (nên có): cắm cáp USB của UPS vào NAS → Phần cứng & Nguồn → UPS → *Bật hỗ trợ UPS*.
5. **Thư mục**: File Station → thư mục chia sẻ `docker` (Container Manager tự tạo) → tạo thư mục con `chat-sieutoc`.
6. (Không bắt buộc, giúp lúc chuyển nhanh hơn) Container Manager → *Sổ đăng ký* → tải trước 2 ảnh `node` (thẻ `24-slim`) và `cloudflare/cloudflared` (thẻ `2026.10.0`).

## B. Chuyển app sang NAS (làm ngoài giờ, khoảng 15–20 phút gián đoạn)

1. **Trên laptop**, mở thư mục `D:\appchatzalommz`, chạy:
   ```
   npm run nas:export
   ```
   Lệnh này **dừng app và tunnel trên laptop**, rồi gói mọi thứ vào `D:\appchatzalommz\nas-export\chat-sieutoc`:
   `app/` (mã nguồn), `data/` (tin nhắn, tài khoản, phiên Zalo, ảnh), `app.env` (cấu hình), `tunnel.env` (token Cloudflare), `docker-compose.yml`.
2. **Chép lên NAS**: kéo *toàn bộ nội dung* thư mục `chat-sieutoc` vào `docker/chat-sieutoc` trên NAS (File Station → Tải lên, hoặc mở `\\<tên-NAS>\docker` trong File Explorer). Chỉ chép qua mạng nội bộ.
3. **Tạo dự án**: Container Manager → *Dự án* → *Tạo*
   - Tên dự án: `chat-sieutoc`
   - Đường dẫn: `/docker/chat-sieutoc`
   - Nguồn: *Sử dụng docker-compose.yml hiện có*
   - Tiếp → bỏ qua phần Web Station → *Hoàn tất*.

   NAS tự build app (lần đầu khoảng 5–10 phút) rồi chạy 2 container.
4. **Kiểm tra**:
   - Mở `https://cskhzalo.sieutoc.com`, đăng nhập như thường.
   - Cài đặt → *Kết nối kênh* và *Zalo nhân viên (giám sát)*: xem trạng thái. Kênh nào báo *hết phiên* thì bấm kết nối lại và quét mã QR (do đổi máy, đổi IP nên có thể phải quét lại một lần).
   - Gửi thử một tin từ điện thoại khách vào Zalo SR, xem app nhận được.
5. **Dọn laptop** (sau khi NAS chạy ổn):
   - Xoá thư mục `D:\appchatzalommz\nas-export` (chứa dữ liệu khách và token).
   - Bỏ tự chạy app trên laptop để nó không bật lại khi mở máy:
     ```
     npx pm2 delete zalo-cskh zalo-cskh-tunnel
     npx pm2 save --force
     ```

**Muốn quay lại laptop** (nếu NAS có sự cố trong lúc chuyển): Container Manager → Dự án `chat-sieutoc` → *Dừng*, rồi trên laptop chạy `npx pm2 start zalo-cskh zalo-cskh-tunnel`. Lưu ý tin nhắn phát sinh trong lúc chạy trên NAS sẽ không có trên laptop.

## C. Sao lưu (làm ngay sau khi chuyển)

1. **Chụp nhanh hằng giờ**: Trung tâm gói → cài *Snapshot Replication* → Ảnh chụp nhanh → chọn thư mục `docker` → Lịch: mỗi giờ, giữ 48 bản. Chụp nhanh của Btrfs chụp nguyên trạng tức thời nên an toàn cho cơ sở dữ liệu.
2. **Sao lưu ra ngoài NAS hằng ngày**: cài *Hyper Backup* → tạo tác vụ sao lưu thư mục `docker/chat-sieutoc/data` lên Google Drive / Synology C2 / ổ USB, chạy mỗi đêm (ví dụ 2 giờ sáng), giữ 30 bản.

## D. Cập nhật bản mới

Khi có bản mới:

1. Trên laptop: `npm run nas:update` → tạo `nas-export\chat-sieutoc\app` (chỉ mã nguồn, không dừng gì, không có dữ liệu).
2. Trên NAS: Container Manager → Dự án `chat-sieutoc` → *Dừng*.
3. Xoá thư mục `docker/chat-sieutoc/app`, chép thư mục `app` mới vào thay. **Không đụng thư mục `data`, `app.env`, `tunnel.env`.**
4. Dự án `chat-sieutoc` → *Hành động* → *Build* (tạo lại) → app tự chạy bản mới.

(Nếu bật SSH trên NAS cho em, phần cập nhật em làm từ xa được, anh không phải thao tác.)

## E. Ghi chú

- App mở cổng `3100` trong mạng nội bộ (`http://<IP-NAS>:3100`, đổi trong `docker-compose.yml` nếu NAS đã dùng cổng này); app chạy trong mạng riêng nên không tranh cổng 3000 với app khác trên NAS. Từ internet chỉ vào được qua `cskhzalo.sieutoc.com`.
- Giới hạn RAM cho app là 3 GB (trong `docker-compose.yml`), thực tế dùng khoảng 100–300 MB.
- Nhật ký: Container Manager → Container → `chat-sieutoc` → *Nhật ký*.
