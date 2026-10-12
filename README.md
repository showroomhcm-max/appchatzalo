# Zalo CSKH — Nhiều nhân viên dùng chung 1 tài khoản Zalo

Web app chăm sóc khách hàng: kết nối **một tài khoản Zalo cá nhân** và cho **nhiều nhân viên cùng lúc** đọc, trả lời tin nhắn trên trình duyệt. Mọi tin gửi đi đều ghi nhận **nhân viên nào gửi**, để thống kê hiệu suất và xuất dữ liệu đào tạo.

## Tính năng

**Đa kênh** (từ v3.0.0): Zalo, Zalo OA (v3.1.0), Facebook Messenger, bình luận Fanpage, TikTok Business, TikTok Shop chung một hộp thư.
Hướng dẫn tạo app Zalo OA / Facebook / TikTok: [docs/ket-noi-facebook-tiktok.md](docs/ket-noi-facebook-tiktok.md).

**Đăng nhập bằng tài khoản Odoo** (erp.sieutoc.com, giống APPDVKT)
- Nhân viên dùng email và mật khẩu Odoo. Ai bật xác thực 2 lớp thì nhập thêm mã OTP.
- Người đăng nhập lần đầu ở trạng thái **Chờ duyệt**. Quản trị viên bấm **Cho phép** trong trang Nhân viên.
- Các login trong `ODOO_ADMINS` (file `.env`) tự động là quản trị viên.
- Tài khoản nội bộ `admin` vẫn giữ để dự phòng khi Odoo gặp sự cố.

**Menu**
- Nhân viên: **Hội thoại**, **Kênh Chat** (tick chọn kênh đang trực, một hay nhiều kênh).
- Quản lý: thêm **Dữ liệu** (báo cáo, chấm điểm, xuất hội thoại để training) và **Cài đặt** (Nhân viên, Bộ phận, Tag, Tin nhắn mẫu, Tích hợp). Trang Kênh Chat của quản lý có thêm kết nối QR và bảng phân công nhân viên × kênh.

**Nhiều kênh Zalo, phân quyền theo bộ phận**
- Kết nối nhiều tài khoản Zalo, mỗi tài khoản là một **kênh** (trang Kênh Zalo, mỗi kênh quét QR riêng).
- **Bộ phận**: quản trị viên chọn bộ phận được xem kênh nào, nhân viên thuộc bộ phận nào (một người có thể thuộc nhiều bộ phận).
- **Vào thẳng kênh**: cấp riêng cho từng nhân viên quyền thấy toàn bộ hội thoại của một kênh, không phụ thuộc bộ phận.
- Tin mới vào bộ phận mặc định của kênh. Người phụ trách chuyển được hội thoại sang bộ phận khác.
- Nhân viên chỉ thấy hội thoại, tag và tin nhắn mẫu của bộ phận mình. Quản trị viên thấy tất cả.
- **Tag** có màu, tạo sẵn trong cài đặt và gắn theo bộ phận. Lọc danh sách hội thoại theo kênh, bộ phận, tag.
- Tag và tin nhắn mẫu **xuất/nhập bằng file Excel** (.xlsx).

**Chat nhiều người**
- Đăng nhập Zalo bằng mã QR ngay trên web. Phiên được lưu lại, khởi động lại máy chủ không phải quét lại.
- Hộp thư realtime: tin mới hiện ngay cho tất cả nhân viên.
- Chống trả lời trùng: thấy ai **đang xem** và ai **đang soạn tin** ở từng hội thoại.
- Nhận / chuyển / bỏ nhận hội thoại. Hội thoại chưa ai nhận sẽ tự giao cho người trả lời đầu tiên.
- Trạng thái (Đang xử lý / Chờ phản hồi / Đã xong), nhãn, mã khách hàng, ghi chú nội bộ.
- Gửi **sticker** (tìm theo từ khóa, có mục dùng gần đây), ảnh và file (kéo, dán hoặc chọn file).
- Rê chuột vào tin nhắn để thao tác như Zalo PC: **trả lời trích dẫn, thả cảm xúc, sao chép, chuyển tiếp, thu hồi, tạo ghi chú**. Cảm xúc khách thả cũng hiện trên tin. Mẫu câu trả lời nhanh: gõ `/` trong ô chat.

**Training và báo cáo**
- Thống kê theo nhân viên: số hội thoại, số tin gửi, thời gian phản hồi trung bình và trung vị, tỉ lệ trả lời trong 5 phút, điểm đánh giá.
- Quản trị viên chấm điểm (1–5 sao) và nhận xét từng hội thoại.
- Xuất dữ liệu theo nhân viên, khoảng ngày hoặc từng hội thoại:
  - **TXT**: kịch bản đối thoại dễ đọc, kèm ghi chú và đánh giá, dùng cho buổi training.
  - **CSV**: mỗi dòng một tin nhắn, mở bằng Excel / Google Sheets.
  - **JSONL**: dạng `user` / `assistant`, dùng để huấn luyện chatbot AI.
  - **JSON**: dữ liệu đầy đủ cho hệ thống khác.

**Tích hợp với web app khác**
- REST API `/api/v1` xác thực bằng API key: đọc hội thoại, gửi tin, gắn mã KH, cập nhật trạng thái, xuất dữ liệu.
- `POST /api/v1/orders` (từ v3.2.0): đẩy đơn hàng vào để gắn với hội thoại theo số điện thoại. Body: `external_id` (bắt buộc), `source`, `code`, `customer_phone`, `customer_name`, `status`, `fulfillment_status`, `total`, `created_at`, `conversation_id` (tùy chọn). Gửi lại cùng `external_id` để cập nhật trạng thái.
- Cảnh báo đơn "rơi" (từ v3.2.0): chưa phản hồi, chưa tạo đơn, chưa đẩy vận chuyển. Webhook gửi sự kiện `alert.created`, `order.updated`.
- Webhook realtime có chữ ký HMAC: `message.received`, `message.sent`, `conversation.assigned`, `conversation.status_changed`.
- Link mở thẳng hội thoại: `https://<domain>/?c=<threadId>`.
- Tài liệu API chi tiết có trong trang **Tích hợp** của app.

## Chạy trên máy (dev)

Cần Node.js 22.5 trở lên (khuyên dùng 24).

```bash
npm install
npm run setup
npm run dev
```

- Giao diện: http://localhost:5173 (chuyển tiếp API sang cổng 3000)
- Lần chạy đầu tạo tài khoản `admin`. Mật khẩu nằm trong `server/data/admin-initial-password.txt`. Đăng nhập xong hãy đổi mật khẩu và xóa file này.
- Muốn xem thử giao diện khi chưa có Zalo: `npm run seed:demo` (tạo 3 hội thoại mẫu, nhân viên `lan` và `minh`, mật khẩu `demo1234`). **Không chạy trên máy chủ thật.**

## Triển khai (production)

App phải chạy **liên tục** để giữ kết nối Zalo, nên cần một máy chủ / VPS. Không dùng được Vercel hay serverless.

**Cách 1: Node trực tiếp**

```bash
cp .env.example .env
npm run setup && npm run build
npm start
```

Nên chạy bằng `pm2` hoặc systemd. Đặt Nginx / Caddy phía trước để có HTTPS, và nhớ bật chuyển tiếp WebSocket cho `/socket.io`.

**Cách 2: Docker**

```bash
docker build -t zalo-cskh .
docker run -d --name zalo-cskh -p 3000:3000 -v zalo-cskh-data:/app/data --restart unless-stopped zalo-cskh
```

**Cách 3: Laptop/PC luôn bật + Cloudflare Tunnel (đang dùng để test)**

```bash
npm run prod:start     # build + chạy app và tunnel bằng pm2
npm run prod:url       # xem link public https://xxx.trycloudflare.com hiện tại
npm run prod:status    # trạng thái
npm run prod:logs      # xem log
```

- `tools/cloudflared.exe` được tải từ trang phát hành chính thức của Cloudflare (không commit lên git).
- Lối tắt `zalo-cskh.cmd` trong thư mục Startup của Windows sẽ chạy `scripts/start-on-login.cmd` (pm2 resurrect) mỗi khi đăng nhập. Xóa lối tắt này để tắt tự khởi động.
- Link Quick Tunnel **đổi mỗi lần tunnel khởi động lại**.
- **Tên miền cố định:** người quản lý Cloudflare tạo tunnel và gửi token. Bấm đúp `scripts/nhap-token-cloudflare.cmd`, dán token và tên miền. Token được lưu ở `tools/cloudflare-tunnel-token.txt` (không commit lên git).

**Sao lưu** thư mục `data/`. Thư mục này chứa database và cookie đăng nhập Zalo, nên phải giữ bí mật.

## Phiên bản

- Phiên bản đang chạy hiện ở góc trái dưới của app (rê chuột để xem giờ cập nhật) và ở đầu trang **Cài đặt**.
- Khi máy chủ cập nhật xong, ai đang mở app sẽ thấy dải **"Đã có phiên bản mới"**, bấm **Tải lại** là dùng bản mới.
- Lịch sử thay đổi: [CHANGELOG.md](CHANGELOG.md). Trên GitHub xem ở mục **Tags** của repo.
- Phát hành bản mới: ghi mục mới vào CHANGELOG.md, chạy `npm run release -- 2.1.0`, rồi `npm run prod:restart` trên máy chủ.

## Lưu ý quan trọng về Zalo cá nhân

- Zalo không có API chính thức cho tài khoản cá nhân. App dùng thư viện cộng đồng [zca-js](https://github.com/RFS-ADRENO/zca-js), mô phỏng Zalo Web. Zalo có thể khóa tài khoản nếu thấy dấu hiệu spam hoặc gửi hàng loạt. Chỉ dùng để trả lời khách.
- Mỗi tài khoản chỉ giữ **một phiên web**. Mở chat.zalo.me hoặc Zalo PC bằng tài khoản này sẽ làm app bị ngắt. Ứng dụng trên điện thoại vẫn dùng song song bình thường.
- Tin trả lời trực tiếp từ điện thoại vẫn được lưu nhưng không biết ai gửi (ghi là "Gửi từ điện thoại"). Muốn số liệu training chính xác thì yêu cầu nhân viên trả lời qua app.
- Lịch sử chỉ đầy đủ **từ lúc kết nối**. Khi mới kết nối, app chỉ đồng bộ được một số tin gần đây mà Zalo còn giữ.
- Nếu sau này cần ổn định và hợp lệ hơn, có thể chuyển sang **Zalo Official Account (OA)**. Khi đó chỉ cần thay `server/src/zalo.ts`, phần còn lại của app giữ nguyên.

## Cấu trúc

```
server/  Node + Express + Socket.IO + SQLite (node:sqlite) + zca-js
  src/zalo.ts           kết nối Zalo: QR, nghe tin, gửi tin
  src/store.ts          lưu hội thoại / tin nhắn
  src/routes.ts         API nội bộ (/api) và API tích hợp (/api/v1)
  src/analytics.ts      thống kê + xuất TXT/CSV/JSONL/JSON
  src/webhooks.ts       gửi sự kiện sang web app khác
  src/realtime.ts       realtime + trạng thái đang xem / đang soạn
web/     React + Vite (giao diện nhân viên)
```
