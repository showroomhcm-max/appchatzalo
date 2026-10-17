# Lịch sử phiên bản

Số phiên bản dạng `LỚN.VỪA.NHỎ`:
- **LỚN**: thay đổi lớn về cách dùng hoặc dữ liệu (ví dụ 1 → 2: chuyển sang nhiều kênh Zalo).
- **VỪA**: thêm tính năng mới.
- **NHỎ**: sửa lỗi, chỉnh giao diện.

Phiên bản đang chạy hiện ở góc trái dưới của app, và ở đầu trang Cài đặt.

## v3.13.0 — 17/10/2026

**Câu trả lời mẫu theo form "Danh sách CTLM"** (giống file xuất từ trang Pancake / Sapo)
- Xuất / nhập Excel đúng các cột: Từ viết tắt, Nội dung, Ảnh đính kèm, Tệp đính kèm, Xin địa chỉ, Cập nhật (+ Bộ phận). Nhận cột theo tên tiêu đề nên đổi thứ tự cột vẫn nhập đúng; file cũ 3 cột vẫn nhập được.
- Ảnh / tệp đính kèm: app tải về từ link (chặn link trỏ vào mạng nội bộ, tối đa 10 MB). Gõ /từ-viết-tắt chọn mẫu là ảnh / tệp tự gắn vào tin, bỏ được nếu không cần.
- Cột Cập nhật giữ nguyên người và ngày từ file; sửa trong app thì ghi tên người sửa. Dòng trùng từ viết tắt cùng nội dung được gộp; khác nội dung được đặt tên mới (vd: ck-2) và báo lại.
- Màn Cài đặt › Câu trả lời mẫu có cột Đính kèm (ảnh thu nhỏ, tệp, nhãn Xin địa chỉ) và Cập nhật; form sửa có link ảnh, link tệp, ô Xin địa chỉ.
- Tag xuất / nhập cùng kiểu (Tên tag, Màu, Bộ phận, Cập nhật).

**Báo cáo giám sát Zalo nhân viên (Excel)**
- Nút **Xuất báo cáo** trên trang Giám sát: chọn hôm nay / 7 ngày / tháng này / khoảng tùy chọn, một hoặc mọi nhân viên.
- 3 trang: **Tổng hợp theo ngày** (số khách, tin khách / nhân viên, tin thu hồi, cờ quy tắc / AI, hội thoại rủi ro cao, điểm AI, tổng quan + việc cần chú ý + góp ý huấn luyện của AI), **Tin cần chú ý** (thời gian, khách, nguồn AI / quy tắc, mức, nội dung, thu hồi, giải thích, đã xem chưa), **Hội thoại** (kết quả, điểm, rủi ro, nhu cầu, tóm tắt, vấn đề do AI chấm). Mỗi lần xuất được ghi nhật ký.

**Gắn cờ giám sát chính xác hơn**
- Số tài khoản, hotline, Zalo có trong câu trả lời mẫu được coi là thông tin chính thức: nhân viên gửi đúng các số này không bị gắn cờ; AI cũng được cho biết các thông tin này.
- Không còn gắn cờ nhầm số tiền (25.990.000đ, 1,990,000 vnd, "giá 1990000") là số tài khoản; số tài khoản có dãy giống số điện thoại không còn bị báo nhầm là "số điện thoại khác".

## v3.12.0 — 17/10/2026

**Trợ lý AI giám sát Zalo nhân viên** (Claude, Anthropic)
- AI tự đọc các hội thoại Zalo nhân viên có tin mới (sau khi ngừng nhắn vài phút): tóm tắt, nhu cầu khách, kết quả (đang tư vấn / đã chốt / khách bỏ đi…), chấm chất lượng tư vấn 1–10, mức rủi ro.
- Tìm dấu hiệu theo ngữ cảnh chứ không chỉ từ khóa: thu tiền / chuyển khoản riêng, kéo khách ra ngoài, giá ngoài chính sách, thái độ, thông tin / cam kết sai, lộ thông tin, bỏ lỡ khách, thu hồi tin đáng ngờ. Mỗi vấn đề có trích nguyên văn tin làm bằng chứng và nút **Xem tin**. Vấn đề mức vừa / cao vào **Tin cần chú ý** (biểu tượng lấp lánh), xếp mức cao lên đầu.
- Trang Giám sát: khung **Phân tích AI** trên đầu mỗi hội thoại (nút Phân tích lại), nhãn rủi ro trong danh sách khách, tab **Tổng hợp AI** cho từng nhân viên theo ngày: tổng quan, điểm, việc cần chú ý, điểm làm tốt, góp ý huấn luyện. Tự tổng hợp lúc 20:00 (đổi được) hoặc bấm Tổng hợp ngay.
- Cài đặt › Zalo nhân viên (giám sát) › **Trợ lý AI**: khóa API Claude, chọn model quét (mặc định Haiku 5.5) và model tổng hợp (mặc định Sonnet 5.5), chu kỳ quét, giờ tổng hợp, giới hạn lượt gọi mỗi ngày, **quy định riêng của công ty** để AI chấm theo. Hiện số lượt / token đã dùng trong ngày.
- Chỉ đọc hội thoại ở kênh giám sát; nội dung chat là dữ liệu, lời trong tin nhắn không đổi được cách AI chấm. Cờ từ khóa cũ vẫn chạy song song.

## v3.11.0 — 16/10/2026

**Kết nối app Báo cáo công việc CSKH** (app mới, thư mục `D:\APPBAOCAOCSKH`, Cloudflare Workers + D1)
- Menu có mục **Báo cáo công việc** (khi đã bật kết nối): bấm là vào thẳng app báo cáo, không đăng nhập lại (vé ký HMAC, sống 2 phút, dùng 1 lần). Người xem được Dữ liệu vào app với vai trò quản lý.
- App báo cáo tự lấy số liệu chat của từng nhân viên: tin đã gửi, hội thoại, thời gian phản hồi, % trả lời trong 5 phút, đánh giá, **đơn POS lên từ chat** (số đơn, tiền), **cảnh báo đơn "rơi"** đã xử lý / còn mở.
- Cài đặt › Kết nối app nội bộ: mục **App Báo cáo công việc CSKH** (địa chỉ, tạo khóa, kiểm tra kết nối hai chiều, bật / tắt), dùng chung khung với mục DVKT.
- Khóa kết nối chỉ mở các đường `/api/link/*` (số liệu báo cáo), không dùng được cho API `/api/v1`.
- `GET /api/v1/work-report` có thêm cột `pos_orders`, `pos_total`, `alerts_resolved`, `alerts_open`.

## v3.10.0 — 16/10/2026

**Kết nối app Dịch vụ kỹ thuật (DVKT ver 3)**
- Khung **Thông tin** của hội thoại có mục **Kỹ thuật (DVKT)**: vé dịch vụ kỹ thuật, đơn giao hàng / hỗ trợ kỹ thuật và phiếu bảo hành của khách (tìm theo số điện thoại đã lưu hoặc số khách gửi trong tin nhắn). Mỗi mục có giai đoạn, kỹ thuật viên phụ trách, dịch vụ đã làm, ngày hẹn bảo hành; nút mở trong app DVKT hoặc Odoo. Chỉ đọc.
- Ngược lại, ở app DVKT (bản 3.20), cạnh nút gọi khách có nút **Nhắn**: mở Chat Siêu Tốc và tự tìm khách theo số (hội thoại đã có, bạn Zalo, tra số Zalo) qua link `#/find/<số điện thoại>`.
- Cài đặt › Tích hợp › **Kết nối app nội bộ**: địa chỉ app DVKT, tạo khóa kết nối (hiện một lần để chép sang DVKT), kiểm tra kết nối, bật / tắt. Khóa chỉ gửi tới địa chỉ https đã lưu; tạo khóa mới thì khóa cũ hết hiệu lực.

**API cho app báo cáo công việc**
- `GET /api/v1/work-report?date=YYYY-MM-DD` (hoặc `from` / `to`, tối đa 93 ngày): số liệu chat của từng nhân viên theo giờ Việt Nam — số tin gửi, số hội thoại, thời gian phản hồi (trung bình, trung vị, % dưới 5 phút), đánh giá, ghi chú. Nhân viên khớp theo email đăng nhập Odoo / `odoo_uid`; người không có tin vẫn có dòng (số 0).

## v3.9.0 — 15/10/2026

**Nhóm chat Zalo**
- Khung thông tin của hội thoại nhóm có mục **Thành viên** (tên, ảnh, trưởng / phó nhóm) và nút **Thêm** người vào nhóm (chọn từ bạn bè Zalo; người đã trong nhóm không hiện).
- **Nhắc tên @** trong nhóm: gõ `@` là hiện danh sách thành viên, chọn tên → Zalo tô tên và báo cho người được nhắc.

**Chat giống Zalo hơn**
- **Đã gửi / Đã nhận / Đã xem** dưới tin cuối của shop (nhóm: "n người đã xem").
- **"Khách đang soạn tin…"** khi khách đang gõ.
- **Xem ảnh toàn màn hình**: bấm ảnh để mở, chuyển ảnh trước / sau (phím mũi tên hoặc vuốt ngang), tải ảnh gốc.
- **Tìm trong hội thoại** (nút kính lúp ở đầu khung chat), bấm kết quả là nhảy tới tin đó.
- **Bảng emoji** trong khung soạn tin; nút sticker đổi biểu tượng cho khỏi nhầm.
- **Kéo thả ảnh / tệp** vào khung chat để gửi.
- Vạch **"Tin nhắn mới"** ở chỗ bắt đầu tin chưa đọc; nút **xuống tin mới nhất** kèm số tin mới khi đang đọc tin cũ.
- **Link trong tin nhắn tự bấm được**.
- Điện thoại / máy tính bảng: **nhấn giữ tin nhắn** để hiện thao tác (trả lời, thả cảm xúc, chuyển tiếp, thu hồi…) như Zalo.

**Giao diện điện thoại và máy tính bảng** (theo bộ khung SieuTocCorp/sieutoc-ui)
- Nhận diện thiết bị theo cả số điểm chạm, không chỉ bề ngang: điện thoại nằm ngang (tới 960px) vẫn là điện thoại, iPad / máy cảm ứng tới 1400px là máy tính bảng, iPad gắn bàn phím không bị nhận nhầm là máy tính, máy gập mở ra không bị kẹt bố cục điện thoại.
- **Điện thoại**: thanh **dưới đáy** kiểu Sapo (Hội thoại · Kênh · Giám sát · Thêm/Tài khoản); mở hội thoại thì khung chat chiếm trọn màn như Zalo (ẩn thanh trên + dưới); hộp thoại thành **tấm trượt từ đáy**; tấm "Thêm" có tài khoản, đăng xuất mọi thiết bị, trạng thái kênh; trang Giám sát mỗi lúc một cấp (nhân viên → khách → tin nhắn).
- **Mọi nút bấm cao 44px** trên màn cảm ứng; ô nhập chữ 16px (iPhone không tự phóng to); chừa chỗ tai thỏ / thanh home của iPhone; tắt "kéo xuống để tải lại" của Chrome (tránh mất tin đang gõ).
- **Máy tính bảng**: danh sách + khung chat cạnh nhau, khung thông tin khách nổi bên phải.

## v3.8.0 — 13/10/2026

**Rà soát và tăng cường bảo mật**
- **Chặn truy cập trực tiếp từ mạng LAN**: app chỉ nhận kết nối đi qua Cloudflare (tên miền). Máy khác trong mạng nội bộ gõ IP:3000 bị chặn. Cần mở để thử nghiệm thì thêm `ALLOW_LAN=1` vào `.env`.
- **Mã đăng nhập không còn nằm trong đường link**: link tải Excel, xuất dữ liệu, tải nhật ký, bắt đầu kết nối Facebook/TikTok/Zalo OA giờ dùng mã dùng một lần sống 2 phút, không lộ phiên 7 ngày qua lịch sử trình duyệt hay nhật ký máy chủ.
- **Thu hồi phiên đăng nhập**: đổi mật khẩu → các thiết bị khác bị đăng xuất; khóa nhân viên → phiên của họ hết hiệu lực ngay; bấm vào ảnh đại diện (góc trái dưới) để **đăng xuất mọi thiết bị** khi nghi lộ tài khoản.
- **Chặn link độc trong tin nhắn khách gửi** (dạng `javascript:`): chỉ link http(s) mới bấm được.
- **File tải lên**: chỉ ảnh / video / âm thanh mở trực tiếp; file khác (html, svg, pdf…) luôn tải về và chạy trong sandbox, không thể chạy mã trên tên miền app.
- **Header bảo mật trình duyệt**: Content-Security-Policy, chống nhúng app vào trang khác (clickjacking), chống đoán kiểu file, HSTS.
- **CORS**: API nội bộ chỉ dùng được từ chính giao diện app; API tích hợp `/api/v1` (API key) vẫn gọi được từ hệ thống khác.
- **Realtime**: "ai đang xem hội thoại nào" chỉ gửi cho người có quyền xem hội thoại đó (trước đây mọi nhân viên đều nhận, lộ tên khách / hội thoại giám sát).
- **Thư viện**: nâng `image-size` (lỗ hổng mức cao: ảnh giả làm treo máy chủ) và `uuid` trong thư viện Excel. `npm audit`: 0 lỗ hổng.
- Đã quét lịch sử GitHub: không có khóa bí mật nào bị đẩy lên.

## v3.7.1 — 13/10/2026

- Bộ lọc loại hội thoại đổi tên thành **Nhóm / Chat / Tất cả**.

## v3.7.0 — 13/10/2026

**Tìm nhóm Zalo khi có nhiều nhóm**
- Nút **Nhóm Zalo** (biểu tượng nhiều người, đầu danh sách hội thoại): liệt kê **tất cả nhóm** tài khoản Zalo đang tham gia, kể cả nhóm chưa có tin nhắn nào trong app. Có ô **tìm theo tên nhóm**, số thành viên, số tin chưa đọc; nhóm có tin gần đây lên trước. Bấm vào nhóm là mở hội thoại nhóm. Nút "Tạo nhóm mới" nằm trong đây.
- Ô **tìm kiếm** ở Hộp thư giờ ra cả nhóm Zalo (giống trên app Zalo).
- Bộ lọc mới **"Khách và nhóm / Chỉ khách (1-1) / Chỉ nhóm"** trong Hộp thư.

## v3.6.1 — 13/10/2026

**Sửa giao diện**
- Lọc nhiều tag: nút chọn cách lọc gọn lại thành **"Tag A hoặc B"** / **"Tag A và B"** (trước bị xuống dòng, cắt chữ khi tên tag dài); dòng bên dưới ghi rõ đang lọc những tag nào.
- Tạo nhóm Zalo: ô tick chọn thành viên bị phóng to và tràn ngang. Đã sửa về đúng cỡ, tên dài tự rút gọn. Các ô tick khác nằm trong biểu mẫu cũng về đúng cỡ.

## v3.6.0 — 13/10/2026

**Menu thao tác hội thoại** (nút ⋯ khi rê chuột, hoặc bấm chuột phải vào hội thoại)
- **Ghim hội thoại**: hội thoại ghim nằm ở mục "Đã ghim" trên cùng danh sách. Ghim riêng từng người.
- **Đánh dấu đã đọc / chưa đọc**.
- **Phân công người hỗ trợ**: chọn nhân viên, "Tôi nhận" hoặc "Bỏ phân công" (theo quyền như trước).
- **Chọn nhiều**: tick nhiều hội thoại (hoặc nút chọn nhiều ở đầu danh sách) rồi Đã đọc / Chưa đọc / Ghim / Xong / Phân công / Xóa cùng lúc.
- **Xóa hội thoại**: ẩn khỏi hộp thư, dữ liệu vẫn giữ để training; khách nhắn lại thì hiện lại. Bộ lọc trạng thái có mục **"Đã xóa"** để xem và **Khôi phục**. Quyền mới **"Xóa hội thoại"** (nhóm Quản trị có sẵn); hội thoại Zalo đang giám sát chỉ Super Admin xóa được.

**Lọc theo nhiều tag**
- Bấm chọn nhiều tag ở bộ lọc Tag, rồi chọn **"A hoặc B"** (có 1 trong các tag) hay **"A và B"** (có đủ các tag).

**Tính năng riêng từng kênh**
- **Zalo cá nhân**: nút **Lời mời kết bạn** ở đầu danh sách (Đồng ý / Từ chối, đồng ý xong mở luôn hội thoại; có số báo khi có lời mời mới), nút **Tạo nhóm** (chọn bạn bè Zalo làm thành viên), và trong khung chat 1-1: **Kết bạn** / Hủy lời mời / Đồng ý kết bạn / nhãn "Bạn bè Zalo".
- **Facebook bình luận**: thêm **Thích**, **Ẩn**, **Hiện lại**, **Xóa bình luận** trong menu "⋯" của từng bình luận.
- **Zalo OA**: nút **Xin thông tin khách** trong khung soạn tin: khách bấm chia sẻ tên, SĐT, địa chỉ → hiện thành tin trong hội thoại và tự lưu SĐT.
- TikTok và TikTok Shop: API của TikTok không có kết bạn / nhóm / thao tác tương tự nên không có thêm.

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
