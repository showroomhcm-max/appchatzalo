# Phương án khi NAS gặp sự cố

App chạy trên Synology DS923+ (dự án `chat-sieutoc`). Phương án dự phòng: **sao lưu ra Google Drive mỗi giờ** + **Bộ dự phòng** chạy trên máy Windows bất kỳ khi NAS hỏng hẳn. Mục tiêu: chạy lại trong khoảng **15 phút**, mất tối đa **1 giờ** dữ liệu nhập trong app (ghi chú, tag, phân công…). Tin nhắn Zalo **không mất**: Zalo gửi bù khi app kết nối lại bằng phiên cũ.

---

## 1. Chuẩn bị trước (làm một lần)

| Việc | Làm ở đâu | Để làm gì |
|---|---|---|
| **App tự sao lưu** | Tự chạy | `data/backups/auto/app-moi-nhat.db` mỗi giờ; `app-YYYY-MM-DD.db` mỗi đêm, giữ 14 ngày |
| **Chép bản sao lưu ra chỗ Cloud Sync đọc được** | Tác vụ tự cập nhật `cap-nhat.sh` (từ v3.30.1) | App chạy bằng uid 1000 nên Cloud Sync không đọc được `data/`. Mỗi phút tác vụ chép `app-moi-nhat.db` + 7 bản theo ngày sang `sao-luu-drive/` |
| **Đẩy lên Google Drive** | DSM › **Cloud Sync** (đã có: đồng bộ cả thư mục `VPS Chat Sieu Toc` lên Drive `Backup Chat Siêu Tốc/VPS Chat Sieu Toc`) | NAS chết vẫn còn bản sao lưu: Drive › `Backup Chat Siêu Tốc › VPS Chat Sieu Toc › sao-luu-drive` |
| **Bộ dự phòng** | Drive › `Backup Chat Siêu Tốc › Bo du phong` (tạo bằng `node scripts/tao-bo-du-phong.mjs`, tạo lại sau mỗi lần phát hành) | File .zip chạy app trên **máy Windows bất kỳ**: có sẵn Node.js, app, đường hầm Cloudflare |
| **Chụp nhanh hằng giờ** | DSM › **Snapshot Replication** › thư mục chia sẻ **Chat Sieu Toc** › mỗi giờ, giữ 48 bản | Lỡ xóa nhầm / hỏng dữ liệu mà NAS vẫn sống: quay lại 1 giờ trước |
| **UPS** cho NAS + modem | Phần cứng & Nguồn › UPS | Cúp điện ngắn không ảnh hưởng; cúp lâu NAS tự tắt an toàn |

**Bật chép sao lưu ra Drive (một lần):** NAS báo có `cap-nhat.sh.moi` → File Station › `VPS Chat Sieu Toc` › đổi tên `cap-nhat.sh` thành `cap-nhat.sh.cu`, đổi tên `cap-nhat.sh.moi` thành `cap-nhat.sh`. Kiểm tra: khoảng 5 phút sau trên Drive có `sao-luu-drive/app-moi-nhat.db` cỡ bằng file trên NAS, cập nhật mỗi giờ.

**Diễn tập (nên làm mỗi quý):** tải bộ dự phòng + một file sao lưu về máy bất kỳ, bấm `CHAY THU.cmd` (không ảnh hưởng NAS), mở `http://localhost:4919` xem dữ liệu.

---

## 2. Gặp sự cố thì làm gì

### A. App lỗi sau khi cập nhật bản mới (NAS vẫn chạy)
Tạo file `.env` trong thư mục dự án trên NAS, ghi `APP_TAG=<số bản trước>` (vd. `APP_TAG=3.18.3`). Trong 1 phút NAS tự quay về bản đó. Báo em sửa, sửa xong xóa file `.env`.

### B. Lỡ xóa nhầm / dữ liệu hỏng (NAS vẫn chạy)
1. Container Manager › Dự án `chat-sieutoc` › **Dừng**.
2. Snapshot Replication › Chat Sieu Toc › chọn bản chụp trước lúc lỗi › khôi phục thư mục `data` (hoặc chép `data/backups/auto/app-moi-nhat.db` đè lên `data/app.db`, xóa `app.db-wal`, `app.db-shm`). Chạy tác vụ *Doi chu thu muc chat* trước khi bật lại.
3. Dự án › **Chạy**.

### C. NAS hỏng hẳn / không lên: chạy "Bộ dự phòng" trên máy Windows bất kỳ
Hướng dẫn chi tiết từng bước nằm trong file `HUONG DAN.txt` của bộ (bản gốc: `deploy/bo-du-phong/HUONG-DAN.txt`). Tóm tắt:
1. **Chắc chắn NAS đã tắt hẳn** (tắt nguồn hoặc rút dây mạng). Hai nơi cùng chạy là Zalo đá nhau.
2. Google Drive (showroomhcm@sieutoc.com) › `Backup Chat Siêu Tốc`:
   - `Bo du phong` › tải file `.zip` › giải nén (ví dụ ra `D:\`).
   - `VPS Chat Sieu Toc › sao-luu-drive` › tải `app-moi-nhat.db` › bỏ vào thư mục `du-lieu-sao-luu` của bộ (hoặc để trong Downloads).
3. Bấm đúp **`CHAY DU PHONG.cmd`** › Enter chọn file sao lưu mới nhất › chờ "Đường hầm Cloudflare đã kết nối".
4. `cskhzalo.sieutoc.com` trỏ về máy đó; nhân viên tải lại trang, không phải đăng nhập lại; Zalo dùng lại phiên cũ, app tự lấy bù tin khách nhắn lúc NAS chết.
5. Không đóng cửa sổ, máy cắm sạc. Lỡ tắt máy: bấm lại `CHAY DU PHONG.cmd`, **Enter để chạy tiếp** dữ liệu đang có.

Laptop có thư mục dự án vẫn dùng được lệnh cũ `node scripts/chay-tam-laptop.mjs "<file .db>"`.

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
- **Chạy bằng bộ dự phòng:** đóng cửa sổ `CHAY DU PHONG` › bấm `GOI DU LIEU VE NAS.cmd` › làm theo mục 3 trong `HUONG DAN.txt` của bộ (dừng dự án trên NAS, chép `app.db` + `uploads` đè vào `data`, xóa `app.db-wal`/`app.db-shm`, chạy tác vụ *Doi chu thu muc chat*, bật dự án). Xong xóa thư mục bộ trên máy đó.
- **Chạy bằng laptop dự án:** `npm run nas:export` › thay thư mục `data` trên NAS bằng `nas-export\chat-sieutoc\data` (giữ nguyên `app.env`, `tunnel.env`, `ghcr.env`, `docker-compose.yml`, `cap-nhat.sh`) › chạy *Doi chu thu muc chat* › bật dự án › xóa `nas-export`.

---

## 4. Ai cần biết gì
- **Anh / quản lý:** mục 2C (NAS hỏng) — tải 2 file trên Drive, bấm đúp 1 file. Không cần laptop dự án.
- **Nhân viên:** khi app báo "Đang kết nối máy chủ…" quá vài phút thì báo quản lý; sau khi chuyển xong chỉ cần tải lại trang.
- **Em (Claude):** đọc nhật ký bằng `node scripts/nhat-ky.mjs` để xem nguyên nhân sự cố.
