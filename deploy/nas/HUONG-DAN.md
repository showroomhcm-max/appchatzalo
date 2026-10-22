# Chạy Chat Siêu Tốc trên Synology DS923+

DS923+ (AMD Ryzen R1600, 8 GB RAM) dư sức cho 20 nhân viên / 30 thiết bị. Dự án `chat-sieutoc` trong Container Manager gồm 3 container:

| Container | Việc |
|---|---|
| `chat-sieutoc-net` | Giữ mạng riêng cho app và tunnel (chỉ ngủ, gần như không tốn gì) |
| `chat-sieutoc` | App chat (giao diện + máy chủ + kết nối Zalo) |
| `chat-sieutoc-tunnel` | Cloudflare Tunnel đưa app ra `https://cskhzalo.sieutoc.com` |

Không mở cổng nào trên router. Tên miền giữ nguyên, không phải sửa gì trên Cloudflare.

> **Quan trọng:** Zalo chỉ cho **một nơi** nhận tin cho mỗi tài khoản. Không bao giờ để app chạy cùng lúc ở laptop và NAS — nơi chạy sau sẽ đá nơi chạy trước, và hai nơi sẽ có dữ liệu lệch nhau.

Thư mục dự án trên NAS (đang dùng: **Chat Sieu Toc › VPS Chat Sieu Toc**):

```
docker-compose.yml   cấu hình 3 container
cap-nhat.sh          tự cập nhật bản mới
ghcr.env             mã chỉ-đọc để tải bản build từ GitHub (anh tự tạo, xem mục D)
app.env              cấu hình app
tunnel.env           token Cloudflare Tunnel
data/                tin nhắn, tài khoản, phiên Zalo, ảnh — KHÔNG xoá
cap-nhat.log         nhật ký cập nhật (tự sinh)
```

---

## A. Chuẩn bị NAS

1. **Cài Container Manager**: Trung tâm gói → *Container Manager* → Cài đặt (DSM 7.2 trở lên).
2. **Không cho ổ cứng ngủ**: Bảng điều khiển → Phần cứng & Nguồn → *Ngủ đông ổ cứng* → *Không bao giờ*.
3. **Tự bật lại khi có điện**: Bảng điều khiển → Phần cứng & Nguồn → Chung → *Khởi động lại tự động sau khi mất điện*.
4. **UPS** (nên có): cắm cáp USB của UPS vào NAS → Phần cứng & Nguồn → UPS → *Bật hỗ trợ UPS*.

## B. Chuyển app từ laptop sang NAS (đã làm ngày 20/10/2026)

1. Trên laptop, trong `D:\appchatzalommz`: `npm run nas:export` — **dừng app trên laptop** và gói `data/`, `app.env`, `tunnel.env`, `docker-compose.yml`, `cap-nhat.sh`, hướng dẫn vào `nas-export\chat-sieutoc`.
2. Chép toàn bộ nội dung đó vào thư mục dự án trên NAS (chỉ qua mạng nội bộ).
3. Làm mục D (mã GitHub + tác vụ tự cập nhật), rồi bấm *Chạy* tác vụ một lần: NAS tải bản build và chạy 3 container.
4. Kiểm tra `https://cskhzalo.sieutoc.com`, Cài đặt → *Kết nối kênh*: kênh nào báo hết phiên thì quét QR lại.
5. Dọn laptop: xoá `D:\appchatzalommz\nas-export`, rồi bỏ tự chạy app trên laptop:
   ```
   npx pm2 delete zalo-cskh zalo-cskh-tunnel
   npx pm2 save --force
   ```

## C. Sao lưu

1. **Chụp nhanh hằng giờ**: cài *Snapshot Replication* → Ảnh chụp nhanh → chọn thư mục chia sẻ **Chat Sieu Toc** → Lịch: mỗi giờ, giữ 48 bản. Chụp nhanh Btrfs chụp nguyên trạng tức thời nên an toàn cho cơ sở dữ liệu.
2. **Sao lưu ra ngoài NAS hằng ngày**: cài *Hyper Backup* → sao lưu thư mục `data` của dự án lên Google Drive / Synology C2 / ổ USB, mỗi đêm, giữ 30 bản.

## D. Tự cập nhật bản mới

Mỗi lần phát hành bản mới, GitHub tự build sẵn (khoảng 3–5 phút). NAS kiểm tra vài phút một lần, thấy bản mới thì tự đổi sang — app ngừng khoảng 20–30 giây, dữ liệu giữ nguyên. Không có bản mới thì không đụng gì tới app.

**1. Tạo mã chỉ-đọc trên GitHub** (làm một lần, anh tự làm, không gửi mã qua chat):
- GitHub → ảnh đại diện → *Settings* → *Developer settings* → *Personal access tokens* → *Tokens (classic)* → *Generate new token (classic)*.
- Note: `NAS chat-sieutoc`, Expiration: *No expiration* (hoặc 1 năm và nhớ gia hạn), chỉ tick **`read:packages`** → *Generate token* → sao chép mã.
- Nếu tổ chức SieuTocCorp bật SSO thì bấm *Configure SSO* → *Authorize* cho SieuTocCorp.

**2. Tạo file `ghcr.env`** trong thư mục dự án (đổi tên `ghcr.env.example` rồi sửa bằng Text Editor của DSM):
```
GHCR_USER=<tên đăng nhập GitHub của anh>
GHCR_TOKEN=<mã vừa tạo>
```

**3. Tạo tác vụ tự cập nhật**: Bảng điều khiển → *Bộ lập lịch tác vụ* → *Tạo* → *Tác vụ đã lên lịch* → *Tập lệnh do người dùng xác định*
- Thẻ *Chung*: Tên `Cập nhật Chat Siêu Tốc`, Người dùng **root**.
- Thẻ *Lịch*: Chạy hằng ngày, *Tần suất*: mỗi **1 phút** (hoặc nhỏ nhất NAS cho), *Thời gian chạy cuối*: 23:59.
- Thẻ *Cài đặt tác vụ* → Tập lệnh do người dùng xác định (sửa `volume1` nếu thư mục nằm ở volume khác — xem trong File Station → chuột phải thư mục → *Thuộc tính*):
  ```
  sh "/volume2/Chat Sieu Toc/VPS Chat Sieu Toc/cap-nhat.sh"
  ```
- *OK*. Chọn tác vụ → *Chạy* để chạy thử ngay, rồi mở `cap-nhat.log` xem kết quả.

**Kiểm tra bản đang chạy**: góc trái dưới của app, hoặc mở `https://cskhzalo.sieutoc.com/api/version`.

**Muốn giữ một bản cố định / quay về bản cũ**: tạo file `.env` trong thư mục dự án với dòng `APP_TAG=3.15.5` (số phiên bản muốn dùng) — lần chạy tác vụ kế tiếp sẽ đổi sang bản đó. Xoá file `.env` để quay lại tự cập nhật bản mới nhất.

## E. Ghi chú

- Trong mạng nội bộ mở app qua `http://<IP-NAS>:3100` (đổi số 3100 trong `docker-compose.yml` nếu NAS đã dùng). App chạy trong mạng riêng nên không tranh cổng với app khác trên NAS.
- Giới hạn RAM cho app là 3 GB, thực tế dùng khoảng 100–300 MB.
- Nhật ký app: Container Manager → Container → `chat-sieutoc` → *Nhật ký*. Nhật ký cập nhật: `cap-nhat.log`.
