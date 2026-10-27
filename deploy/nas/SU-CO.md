# Phương án khi NAS gặp sự cố

App chạy trên Synology DS923+ (dự án `chat-sieutoc`). Phương án dự phòng: **sao lưu ra ngoài NAS mỗi giờ** + **laptop chạy thay** khi NAS hỏng hẳn. Mục tiêu: chạy lại trong khoảng **15 phút**, mất tối đa **1 giờ** dữ liệu nhập trong app (ghi chú, tag, phân công…). Tin nhắn Zalo **không mất**: Zalo gửi bù khi app kết nối lại bằng phiên cũ.

---

## 1. Chuẩn bị trước (làm một lần, ngay bây giờ)

| Việc | Làm ở đâu | Để làm gì |
|---|---|---|
| **App tự sao lưu** (có sẵn từ v3.18.4) | Tự chạy | `data/backups/auto/app-moi-nhat.db` ghi đè mỗi giờ; `app-YYYY-MM-DD.db` mỗi đêm, giữ 14 ngày |
| **Đẩy bản sao lưu ra Google Drive** | DSM › Trung tâm gói › cài **Cloud Sync** › thêm Google Drive (tài khoản Google của công ty) | NAS chết vẫn còn bản sao lưu trên Drive |
| **Chụp nhanh hằng giờ** | DSM › **Snapshot Replication** › thư mục chia sẻ **Chat Sieu Toc** › mỗi giờ, giữ 48 bản | Lỡ xóa nhầm / hỏng dữ liệu mà NAS vẫn sống: quay lại 1 giờ trước |
| **UPS** cho NAS + modem | Phần cứng & Nguồn › UPS | Cúp điện ngắn không ảnh hưởng; cúp lâu NAS tự tắt an toàn |
| **Giữ laptop sẵn sàng** | Laptop có `D:\appchatzalommz` (đừng xóa thư mục `tools`, có token Cloudflare) | Laptop chạy thay khi NAS hỏng |

**Cài Cloud Sync (chi tiết):**
1. Cloud Sync › **+** › Google Drive › đăng nhập tài khoản Google của công ty (tài khoản riêng cho sao lưu, không chia sẻ thư mục cho ai).
2. Thư mục cục bộ: `Chat Sieu Toc/VPS Chat Sieu Toc/data/backups/auto`.
3. Thư mục trên Drive: tạo `Sao luu Chat Sieu Toc`.
4. Hướng đồng bộ: **Chỉ tải lên các thay đổi cục bộ** (không xóa trên Drive khi NAS xóa bản cũ cũng được).
5. Không bật mã hóa của Cloud Sync (để khi cần chỉ việc tải file về dùng). Bù lại: **không chia sẻ thư mục Drive này** — file chứa tin nhắn khách và phiên đăng nhập Zalo.

Kiểm tra: sau khoảng 1 giờ, trên Drive có `app-moi-nhat.db` và `app-<ngày>.db`.

---

## 2. Gặp sự cố thì làm gì

### A. App lỗi sau khi cập nhật bản mới (NAS vẫn chạy)
Tạo file `.env` trong thư mục dự án trên NAS, ghi `APP_TAG=<số bản trước>` (vd. `APP_TAG=3.18.3`). Trong 1 phút NAS tự quay về bản đó. Báo em sửa, sửa xong xóa file `.env`.

### B. Lỡ xóa nhầm / dữ liệu hỏng (NAS vẫn chạy)
1. Container Manager › Dự án `chat-sieutoc` › **Dừng**.
2. Snapshot Replication › Chat Sieu Toc › chọn bản chụp trước lúc lỗi › khôi phục thư mục `data` (hoặc chép `data/backups/auto/app-moi-nhat.db` đè lên `data/app.db`, xóa `app.db-wal`, `app.db-shm`).
3. Dự án › **Chạy**.

### C. NAS hỏng hẳn / không lên (laptop chạy thay)
1. **Chắc chắn NAS đã tắt hẳn** (tắt nguồn hoặc rút dây mạng). Hai nơi cùng chạy là Zalo đá nhau.
2. Trên laptop: vào Google Drive › `Sao luu Chat Sieu Toc` › tải **`app-moi-nhat.db`** về (vd. thư mục Downloads).
3. Mở PowerShell:
   ```
   cd D:\appchatzalommz
   node scripts/chay-tam-laptop.mjs "C:\Users\LENOVO\Downloads\app-moi-nhat.db"
   ```
   Lệnh tự kiểm tra NAS đã tắt chưa, cất dữ liệu cũ của laptop, nạp bản sao lưu, build và bật app + tunnel. Tên miền `cskhzalo.sieutoc.com` trỏ về laptop sau khoảng 30 giây.
4. Mở app › Cài đặt › **Kết nối kênh** › mỗi kênh Zalo bấm **Đồng bộ tin nhắn cũ**: Zalo gửi bù tin từ lúc sao lưu đến giờ (kênh dùng lại phiên cũ nên Zalo nhận ra là cùng thiết bị).
5. Nhân viên tải lại trang là dùng tiếp. Laptop phải **cắm sạc, không cho ngủ, mạng ổn định** trong thời gian chạy thay.

### D. Mất điện / mất mạng văn phòng
- Ngắn (dưới 30 phút): chờ. UPS giữ NAS; có mạng lại app tự kết nối và Zalo gửi bù tin.
- Kéo dài và cần làm việc gấp: mang laptop ra chỗ có mạng, làm như mục C (lấy bản sao lưu trên Drive).

### E. Web báo "Error 1033 – Cloudflare Tunnel error"
Đường hầm Cloudflare trên NAS không kết nối (thường sau khi dừng / bật tay từng container). Dữ liệu không sao.
- Đợi 1–2 phút: tác vụ tự cập nhật (từ v3.26.3) tự phát hiện container chạy trên mạng cũ và khởi động lại.
- Vẫn lỗi: Container Manager › **Dự án** › `chat-sieutoc` › **Dừng** › **Hành động › Xây dựng**.
- Muốn tắt / bật app: luôn dừng / khởi động **cả dự án**, không dừng riêng từng container.

---

## 3. Quay về NAS sau khi sửa xong
1. Trên laptop: `cd D:\appchatzalommz` rồi `npm run nas:export` — dừng app trên laptop và gói dữ liệu mới nhất vào `nas-export\chat-sieutoc\data`.
2. Trên NAS: dự án `chat-sieutoc` › **Dừng** › thay thư mục `data` bằng thư mục `data` vừa gói (giữ nguyên `app.env`, `tunnel.env`, `ghcr.env`, `docker-compose.yml`, `cap-nhat.sh`).
3. Dự án › **Chạy**. Kiểm tra tên miền + Kết nối kênh.
4. Xóa thư mục `nas-export` trên laptop.

---

## 4. Ai cần biết gì
- **Anh / quản lý:** mục 2C (NAS hỏng) — chỉ cần tải 1 file và chạy 1 lệnh. Muốn chắc ăn, nhắn em: em làm từ xa trên laptop.
- **Nhân viên:** khi app báo "Đang kết nối máy chủ…" quá vài phút thì báo quản lý; sau khi chuyển xong chỉ cần tải lại trang.
- **Em (Claude):** đọc nhật ký bằng `node scripts/nhat-ky.mjs` để xem nguyên nhân sự cố.
