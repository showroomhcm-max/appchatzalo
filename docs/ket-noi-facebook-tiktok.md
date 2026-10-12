# Kết nối Zalo OA, Facebook, TikTok, TikTok Shop

Ngoài Zalo cá nhân (quét QR), app nhận và trả lời được:

| Nền tảng | Nhận được | Trả lời được |
|---|---|---|
| Zalo OA (từ v3.1.0) | Chữ, ảnh, tệp, sticker, link, vị trí | Chữ, ảnh, tệp. Tin tư vấn trong **7 ngày** kể từ lần cuối khách tương tác |
| Facebook Messenger | Tin nhắn, ảnh, tệp | Chữ, ảnh, tệp. Trong **24 giờ** kể từ tin cuối của khách |
| Bình luận Fanpage | Bình luận mới dưới bài viết | Trả lời **công khai** dưới bình luận, hoặc **nhắn riêng** qua Messenger (1 lần mỗi bình luận, trong 7 ngày) |
| TikTok Business | Tin nhắn trực tiếp | Chữ. Trong **48 giờ**, tối đa 10 tin mỗi lần khách nhắn |
| TikTok Shop | Chat với người mua | Chữ, tối đa 2.000 ký tự |

Mỗi nền tảng (trừ Zalo cá nhân) cần **một app nhà phát triển** (làm một lần). Sau đó vào **Kênh Chat › Thêm kênh** để đăng nhập từng Fanpage, tài khoản TikTok hoặc shop.

Tất cả đường dẫn cần dán vào trang của nền tảng đều có sẵn ở **Cài đặt › Tích hợp**, bấm "Chép" để lấy. Ví dụ với tên miền hiện tại:

- Callback Zalo OA: `https://cskhzalo.sieutoc.com/api/oauth/zalo-oa/callback`
- Webhook Zalo OA: lấy ở Cài đặt › Tích hợp (có khóa bí mật ở cuối, `?k=...`)
- Webhook Facebook: `https://cskhzalo.sieutoc.com/webhooks/meta`
- Redirect Facebook: `https://cskhzalo.sieutoc.com/api/oauth/facebook/callback`
- Webhook TikTok: lấy ở Cài đặt › Tích hợp (có khóa bí mật ở cuối, `?k=...`)
- Redirect TikTok: `https://cskhzalo.sieutoc.com/api/oauth/tiktok/callback`
- Webhook TikTok Shop: `https://cskhzalo.sieutoc.com/webhooks/tiktok-shop`
- Redirect TikTok Shop: `https://cskhzalo.sieutoc.com/api/oauth/tiktok-shop/callback`

> App phải chạy ở tên miền công khai có HTTPS (cskhzalo.sieutoc.com qua Cloudflare là được). Link tạm `trycloudflare.com` đổi mỗi lần khởi động lại nên không dùng được cho Facebook/TikTok.

---

## 0. Zalo Official Account (OA)

Khác Zalo cá nhân: đây là **API chính thức** của Zalo, không lo bị khóa tài khoản, nhiều nhân viên chat cùng lúc thoải mái.

1. Vào https://developers.zalo.me/ → **Thêm ứng dụng mới** (đăng nhập bằng tài khoản Zalo quản trị OA).
2. Trong ứng dụng: **Official Account › Thiết lập chung** → **Callback URL**: dán "Callback URL" từ app Zalo CSKH. Liên kết ứng dụng với OA của MemoryZone.
3. Bật các quyền của OA: gửi tin nhắn, quản lý người dùng (đọc thông tin người quan tâm), quản lý tin nhắn.
4. **Xác thực tên miền** (Zalo yêu cầu trước khi bật webhook): Zalo cho một tên file dạng `zalo_verifierXXXX.html`. Dán phần `XXXX` vào ô "Mã xác thực tên miền" trong app rồi **Lưu**, app tự phục vụ file đó. Quay lại Zalo bấm **Xác thực**.
5. **Webhook**: dán "Webhook URL", bật các sự kiện `user_send_text`, `user_send_image`, `user_send_file`, `user_send_sticker`, `user_send_link`, `user_send_location`, `user_send_audio`, `user_send_video`, `user_send_gif` và `oa_send_text`, `oa_send_image`, `oa_send_file` (để lưu cả tin gửi từ trang quản lý OA). Chép **OA Secret Key** ở trang này.
6. **Thông tin ứng dụng**: chép **ID ứng dụng** và **Khóa bí mật của ứng dụng**.
7. Trong app Zalo CSKH: **Cài đặt › Tích hợp › Zalo OA**, dán App ID, khóa bí mật, OA Secret Key, **Lưu**.
8. **Kênh Chat › Kết nối kênh › Đăng nhập Zalo OA** → chọn OA → **Cho phép**.

Token OA tự làm mới. Nếu ngưng dùng app quá 3 tháng, bấm **Đăng nhập lại Zalo OA** trên kênh.

---

## 1. Facebook (Messenger + bình luận)

### Tạo Meta App
1. Vào https://developers.facebook.com/apps/ → **Create App** → chọn loại **Business**, gắn vào Business Portfolio của công ty.
2. Thêm sản phẩm **Messenger** và **Facebook Login for Business** (hoặc Facebook Login).
3. **App settings › Basic**: lấy **App ID** và **App Secret**. Điền thêm Privacy Policy URL (bắt buộc khi xin duyệt).
4. Trong app Zalo CSKH: **Cài đặt › Tích hợp › Meta App**, dán App ID và App Secret, bấm **Lưu**. App tự tạo **Verify token**.

### Cấu hình Webhook
1. Meta App › **Messenger › Settings** (hoặc **Webhooks**), chọn object **Page**.
2. **Callback URL**: dán "Callback URL (Webhooks › Page)". **Verify token**: dán "Verify token". Bấm **Verify and save**.
3. Đăng ký các field: `messages`, `message_echoes`, `message_reactions`, `messaging_postbacks`, `feed`.

### Cấu hình đăng nhập
- **Facebook Login › Settings › Valid OAuth Redirect URIs**: dán "Valid OAuth Redirect URI".

### Quyền cần xin (App Review)
`pages_show_list`, `pages_manage_metadata`, `pages_messaging`, `pages_read_engagement`, `pages_read_user_content`, `pages_manage_engagement`, `business_management`.

- Khi app ở chế độ **Development**: chỉ người có vai trò trong app (Admin / Developer / Tester) dùng được, đủ để thử.
- Để nhận tin của **khách thật**: chuyển app sang **Live** và xin **Advanced Access** cho các quyền trên (App Review, cần xác minh doanh nghiệp, quay video thao tác trả lời tin trong app).

### Kết nối Fanpage
**Kênh Chat › Thêm kênh › Đăng nhập Facebook** → đăng nhập tài khoản quản trị Fanpage → tick các trang → **Kết nối**. Mỗi trang thành một kênh. Gán bộ phận và nhân viên cho kênh như kênh Zalo.

Cách dự phòng: dán **Page Access Token** (lấy ở Graph API Explorer) vào ô "Hoặc dán Page Access Token".

---

## 2. TikTok Business (tin nhắn)

1. Đăng ký tài khoản nhà phát triển ở https://business-api.tiktok.com/portal → **My Apps › Create App**.
2. Xin quyền **Business Messaging** (TikTok cần duyệt; tài khoản TikTok phải là tài khoản Business ở khu vực được hỗ trợ).
3. **Advertiser redirect URL**: dán "Redirect URL" trong app Zalo CSKH.
4. Lấy **App ID**, **Secret**, và **link ủy quyền** (Authorization URL) ở trang app.
5. **Cài đặt › Tích hợp › TikTok for Business**: dán 3 thông tin trên, **Lưu**, rồi bấm **Đăng ký webhook** (app tự đăng ký Webhook URL với TikTok).
6. **Kênh Chat › Thêm kênh › Đăng nhập TikTok** → cho phép quyền nhắn tin.

Token TikTok tự làm mới. Ủy quyền hết hạn sau 1 năm, khi đó bấm **Đăng nhập lại TikTok** trên thẻ kênh.

---

## 3. TikTok Shop (chat với người mua)

1. Đăng ký **TikTok Shop Partner Center** https://partner.tiktokshop.com/ (tài khoản Developer / ISV) → tạo **Custom App** cho shop của mình.
2. Xin scope **Customer Service** (nhóm quyền hạn chế, cần gửi đơn xin duyệt đặc biệt kèm mô tả dùng để chăm sóc khách).
3. **Redirect URL**: dán "Redirect URL" trong app Zalo CSKH.
4. Lấy **App Key**, **App Secret**, **Service ID**.
5. **Cài đặt › Tích hợp › TikTok Shop Partner**: dán 3 thông tin, **Lưu**.
6. **Kênh Chat › Thêm kênh › Đăng nhập TikTok Shop** → đăng nhập Seller Center, ủy quyền. Mỗi shop thành một kênh, app tự đăng ký webhook tin nhắn mới.

App còn tự quét tin mới mỗi phút để không sót tin nếu webhook trễ.

---

## Bảo mật
- App Secret chỉ quản trị viên có quyền **Tích hợp** nhập, lưu trên máy chủ, không bao giờ hiện lại đầy đủ.
- Mọi webhook đều kiểm tra chữ ký (Facebook, TikTok Shop) hoặc khóa bí mật trong URL (TikTok). Yêu cầu giả bị từ chối.
- Ngắt kết nối kênh sẽ xóa token đã lưu của kênh đó; lịch sử chat giữ nguyên để training.
