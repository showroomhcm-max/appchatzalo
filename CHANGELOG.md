# Lịch sử phiên bản

Số phiên bản dạng `LỚN.VỪA.NHỎ`:
- **LỚN**: thay đổi lớn về cách dùng hoặc dữ liệu (ví dụ 1 → 2: chuyển sang nhiều kênh Zalo).
- **VỪA**: thêm tính năng mới.
- **NHỎ**: sửa lỗi, chỉnh giao diện.

Phiên bản đang chạy hiện ở góc trái dưới của app, và ở đầu trang Cài đặt.

## v3.5.0 — 13/10/2026

**Giám sát Zalo nhân viên** (làm lại theo đúng ý: công ty cấp SIM, nhân viên tự tạo Zalo và chat với khách bằng điện thoại)
- **Cài đặt › Quản lý chung › Zalo nhân viên (giám sát)**: bấm "Thêm Zalo nhân viên", nhập SĐT công ty cấp + nhân viên nhận → app hiện mã QR, dùng Zalo trên điện thoại nhân viên quét. Từ lúc đó mọi tin nhắn với khách được lưu về app, nhân viên vẫn chat trên điện thoại như bình thường. Có thể chuyển một kênh Zalo đang có sang chế độ giám sát.
- **Menu mới "Giám sát"** (biểu tượng con mắt): chọn nhân viên → danh sách khách → xem toàn bộ hội thoại (chỉ xem). Có tìm theo tên khách, SĐT, nội dung tin.
- **Tin nhân viên thu hồi vẫn xem được**, kèm giờ thu hồi.
- **Tin cần chú ý** (tự gắn cờ): nhân viên gửi số tài khoản / ví, gửi số điện thoại khác số công ty, hoặc tin có từ khóa (chuyển khoản cho em, zalo riêng, giá riêng, shop khác… tự chỉnh được). Bấm "Đã xem, bình thường" để bỏ cờ.
- **Mất giám sát**: khi nhân viên đăng xuất phiên Zalo Web trên điện thoại, app báo đỏ và ghi lại giờ; bấm "Quét QR" để kết nối lại.
- Số liệu hôm nay từng nhân viên: số khách, tin khách, tin nhân viên, tin thu hồi, khách chờ trả lời.
- **Bảo mật**: hội thoại giám sát không vào hộp thư chung; chỉ người có quyền mới **"Giám sát tin nhắn Zalo nhân viên"** (nhóm Quản trị có sẵn) và chính nhân viên giữ máy xem được — kể cả người có quyền "xem tất cả hội thoại" cũng không thấy nếu thiếu quyền này. Quản lý chỉ xem, không gửi tin thay nhân viên. Mỗi lần mở xem được ghi nhật ký.
- Vẫn giữ: hồ sơ SIM, cấp / thu hồi / bàn giao có checklist, nhân viên bị khóa → "Cần thu hồi".

## v3.4.1 — 13/10/2026

**Sửa lỗi**
- Biểu tượng trên tab trình duyệt vẫn là hình cũ do trình duyệt / Cloudflare giữ bản cũ trong bộ nhớ đệm. Đổi sang file mới (`mmz-icon.svg`) để tải lại ngay; thêm bản PNG, `favicon.ico` và icon khi lưu ra màn hình điện thoại, tất cả là logo MemoryZone.

## v3.4.0 — 13/10/2026

**Đồng bộ đơn hàng** (Cài đặt › Tích hợp, trước là "Đồng bộ Sapo")
- Phần Sapo đổi tên thành **Đồng bộ đơn Sapo** (vẫn đang chuẩn bị, chưa bật).
- Mới: **Đồng bộ đơn hàng POS (Odoo)**: nhân viên bấm **Lên đơn POS** trong khung thông tin khách, tìm sản phẩm (tên, mã, mã vạch, có tồn kho), chỉnh số lượng / giá / chiết khấu → đơn tạo trên POS Odoo ở trạng thái nháp, trong ca đang mở của điểm bán được chọn.
  - Khách tìm theo số điện thoại trên Odoo, chưa có thì tạo mới. Đơn ghi tên nhân viên bán (theo tài khoản Odoo của nhân viên), kênh bán theo nền tảng chat, địa chỉ và ghi chú.
  - Giá đã gồm thuế như POS; app tự tách tiền trước thuế theo thuế của sản phẩm.
  - Ca POS chưa mở: đơn chờ trong app, tự đẩy lên khi thu ngân mở ca.
  - Trạng thái đơn (nháp, chờ thanh toán, giữ hàng, đã thanh toán, hoàn tất, hủy) và "Trạng thái giao hàng" lấy về mỗi 2 phút → cảnh báo "chưa tạo đơn" / "chưa đẩy vận chuyển" tự cập nhật.
  - Quản trị nhập tài khoản Odoo tích hợp + API key, bấm **Kiểm tra kết nối**, chọn điểm bán mặc định và kênh bán, rồi **Bật**.
  - Quyền mới **Lên đơn hàng POS (Odoo) từ hội thoại**, các nhóm mẫu có sẵn.

**Sửa lỗi**
- Trình duyệt tự điền email + mật khẩu đăng nhập vào ô API key / mật khẩu Sapo. Đã tắt tự điền ở các ô khóa bí mật và chặn lưu API key dạng email.

## v3.3.0 — 13/10/2026

**Đổi tên: Chat Siêu Tốc**
- App đổi tên thành **Chat Siêu Tốc**, dùng logo MemoryZone (mark "M" màu lime) ở màn đăng nhập, thanh menu và biểu tượng tab trình duyệt.

**Zalo & SĐT công ty cấp cho nhân viên** (Cài đặt › Quản lý chung)
- Mỗi tài khoản Zalo (quét QR) là tài sản công ty: nhập **SĐT, nhà mạng, serial SIM, điện thoại**; trạng thái Đang cấp / Trong kho / Cần thu hồi / Mất máy / Tạm khóa.
- **Cấp cho nhân viên**: người nhận được vào thẳng kênh trên app. **Thu hồi / bàn giao**: chọn người nhận hoặc thu về kho, khách đang tư vấn tự chuyển sang người mới, tick **checklist** (thu SIM, đổi mật khẩu Zalo, bàn giao khách, kiểm tra danh bạ).
- **Tin nhắn từ điện thoại** giờ ghi tên người đang giữ máy ("Gửi từ điện thoại · tên"). Mỗi tài khoản có số liệu hôm nay: khách nhắn, trả lời trên app, nhắn từ điện thoại, hội thoại chờ trả lời.
- **Khóa nhân viên** còn giữ Zalo công ty → tài khoản tự chuyển **Cần thu hồi**, có cảnh báo trên trang. Hồ sơ nhân viên hiện tài khoản họ đang giữ.
- **Lịch sử** từng tài khoản: ai giữ từ lúc nào đến lúc nào, ai cấp / thu hồi, checklist, các lần Zalo **mất kết nối** (dấu hiệu đăng nhập Zalo PC / Web ở máy khác).
- Khách hàng và lịch sử chat luôn thuộc tài khoản công ty, không mất khi nhân viên nghỉ.

## v3.2.0 — 13/10/2026

**Cài đặt có menu bên trái**
- Cài đặt chia nhóm như các phần mềm bán hàng: **Tích hợp** (Kết nối kênh, App nền tảng, API & Webhook, Đồng bộ Sapo), **Quản lý chung** (Cảnh báo đơn "rơi", Nhật ký hệ thống), **Quản lý hội thoại** (Tin nhắn mẫu, Tag, Bộ phận), **Phân quyền** (Nhân viên, Nhóm quyền).
- **Kết nối kênh** chuyển vào Cài đặt › Tích hợp: thêm kênh, quét QR, kích hoạt, phân công nhân viên. Trang **Kênh Chat** ở menu chính giờ chỉ để chọn kênh đang chat.
- Mỗi mục có link riêng (`#/settings/alerts`, `#/settings/channels`…); trên điện thoại menu thành ô chọn.

**Cảnh báo đơn "rơi"** (Cài đặt › Quản lý chung)
- **Chưa phản hồi**: khách nhắn mà quá thời gian chọn (15 phút đến 1 ngày) chưa ai trả lời.
- **Chưa tạo đơn**: khách đã để lại **số điện thoại**, **địa chỉ** hoặc nói **từ khóa** mua hàng (tự nhận ra trong tin nhắn, không phân biệt dấu) mà chưa có đơn.
- **Chưa đẩy vận chuyển**: hội thoại có đơn nhưng quá giờ chưa giao vận chuyển (chạy khi có đơn từ Sapo / API).
- Hộp thư: nhãn đỏ trên hội thoại, nút lọc **Cảnh báo (n)**, số đếm trên menu Hội thoại. Khung thông tin khách có nút **Đã xử lý**.
- Cảnh báo tự tắt khi đã trả lời, đã có đơn, đã giao vận chuyển.
- Quyền mới: **Cấu hình cảnh báo đơn "rơi"** (nhóm Quản trị có sẵn).

**Chuẩn bị kết nối Sapo POS (chưa bật)**
- Bảng đơn hàng gắn với hội thoại; đơn tự ghép vào hội thoại theo số điện thoại khách (số khách gõ trong chat cũng được nhận ra và lưu).
- Trang **Đồng bộ Sapo**: nhập trước tên cửa hàng, API key, mật khẩu API, khóa ký webhook. Phần nhận webhook Sapo đã viết sẵn nhưng chưa bật.
- API mới `POST /api/v1/orders`: web bán hàng / hệ thống khác đẩy đơn vào ngay từ bây giờ. Khung thông tin khách hiện danh sách đơn.

## v3.1.0 — 13/10/2026

**Zalo OA**
- Kết nối **Zalo Official Account** bằng API chính thức của Zalo: nhận chữ, ảnh, tệp, sticker, link, vị trí; trả lời chữ, ảnh, tệp. Tin gửi từ trang quản lý OA cũng được lưu.
- Cài đặt › Tích hợp có thẻ **Zalo OA**: nhập App ID, khóa bí mật, OA Secret Key; app tự phục vụ file xác thực tên miền của Zalo.

**Kênh Chat làm lại**
- Tab theo nền tảng: Tất cả / Zalo / Zalo OA / Facebook / TikTok / TikTok Shop, kèm số kênh.
- Kênh xếp theo nhóm nền tảng, mỗi kênh một ô gọn (ảnh, tên, ID tài khoản, chấm trạng thái). Bấm vào kênh để xem chi tiết, quét QR, phân quyền.
- Tick các kênh muốn chat rồi bấm **Truy cập** để vào hộp thư chỉ với các kênh đó.
- Quản lý thấy cột **Kênh chưa kích hoạt** (kênh đang tắt), tick rồi bấm **Kích hoạt**.

**Chọn nhanh kênh ở góc trên**
- Nút **"Đã chọn N kênh"** ở góc phải trên mọi trang (khi được chia từ 2 kênh trở lên): tick kênh theo nhóm nền tảng, bấm Áp dụng, hộp thư lọc ngay.

## v3.0.0 — 12/10/2026

**Đa kênh: Facebook, TikTok, TikTok Shop chung một hộp thư với Zalo**
- **Facebook Messenger**: nhận và trả lời tin nhắn Fanpage (chữ, ảnh, tệp). Tin trả lời từ Meta Business Suite / điện thoại cũng được lưu.
- **Bình luận Facebook**: mỗi người bình luận dưới một bài viết thành một hội thoại (nhãn "Bình luận", có link bài viết). Khi trả lời chọn **Trả lời công khai** (dưới bình luận) hoặc **Nhắn riêng qua Messenger**. Bấm "Trả lời" trên một bình luận để trả lời đúng bình luận đó.
- **TikTok Business**: nhận và trả lời tin nhắn trực tiếp của tài khoản TikTok doanh nghiệp.
- **TikTok Shop**: nhận và trả lời chat của người mua (mỗi shop một kênh, tự quét tin mới mỗi phút).
- **Kênh Chat › Thêm kênh**: chọn Zalo (quét QR), Facebook, TikTok hoặc TikTok Shop (đăng nhập ủy quyền). Facebook cho chọn nhiều Fanpage một lần.
- **Cài đặt › Tích hợp**: nhập thông tin app Meta / TikTok / TikTok Shop, có sẵn các đường dẫn webhook và redirect để chép.
- Danh sách hội thoại có ký hiệu nền tảng trên ảnh đại diện; khung chat chỉ hiện nút mà nền tảng đó hỗ trợ (sticker, cảm xúc, thu hồi, chuyển tiếp chỉ có ở Zalo).
- Bộ phận, phân quyền, tag, tin nhắn mẫu, xuất dữ liệu training dùng chung cho mọi kênh.
- Hướng dẫn tạo app từng nền tảng: `docs/ket-noi-facebook-tiktok.md`.

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
