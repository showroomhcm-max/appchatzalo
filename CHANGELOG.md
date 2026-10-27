# Lịch sử phiên bản

Số phiên bản dạng `LỚN.VỪA.NHỎ`:
- **LỚN**: thay đổi lớn về cách dùng hoặc dữ liệu (ví dụ 1 → 2: chuyển sang nhiều kênh Zalo).
- **VỪA**: thêm tính năng mới.
- **NHỎ**: sửa lỗi, chỉnh giao diện.

Phiên bản đang chạy hiện ở góc trái dưới của app, và ở đầu trang Cài đặt.

## v3.29.3 — 28/10/2026

- **Sắp xếp lại menu Cài đặt theo thứ tự thiết lập**, mỗi nhóm một việc:
  - **Kênh chat**: Kết nối kênh.
  - **Hội thoại**: Bộ phận - phân chia hội thoại, Câu trả lời mẫu, Tag hội thoại.
  - **Giám sát & chất lượng**: Zalo nhân viên (giám sát), Trợ lý AI, Chấm tư vấn (kịch bản), Gắn cờ tin cần chú ý, Cảnh báo đơn "rơi".
  - **Kết nối hệ thống**: Đồng bộ đơn hàng, Kết nối app & API.
  - **Nhân viên & bảo mật**: Nhân viên, Nhóm quyền, Nhật ký hệ thống.
- **Trợ lý AI có mục riêng** (trước nằm cuối trang Zalo nhân viên). Chia 2 khung: **Kết nối AI** (nhà cung cấp, khóa, giới hạn lượt, dùng chung cho cả Chấm tư vấn) và **AI đọc tin Zalo nhân viên** (model, giờ tổng hợp, quy định công ty, bật / tắt).
- **Gắn cờ tin cần chú ý** (số tài khoản, SĐT khác, từ khóa) tách khỏi trang Zalo nhân viên thành mục riêng. Trang Zalo nhân viên giờ chỉ còn quản lý SIM / tài khoản, có link sang 2 mục trên. Link cũ `#/settings/company` vẫn mở được.

## v3.29.2 — 27/10/2026

- **Quét QR gắn tài khoản Zalo xong là tự lấy tin cũ từ Zalo PC**: nếu đã cài máy đồng bộ, app tự giao việc 90 ngày cho máy có Zalo PC cùng tài khoản, không cần bấm thêm nút. Dưới nút "Đồng bộ tin nhắn cũ" luôn hiện dòng **Zalo PC** (bao nhiêu máy đang bật), thông báo "Zalo không trả tin cũ" ghi rõ tin cũ hơn sẽ lấy từ Zalo PC.
- **Xóa sạch dữ liệu chat** (Super Admin, qua máy chủ, phải gõ xác nhận `XOA SACH`): dùng trước khi giao app cho nhân viên. Đăng xuất và xóa mọi kênh, xóa hết hội thoại, tin nhắn, khách, ghi chú, đơn, đánh giá, dữ liệu AI, nhãn, mẫu tin, cài đặt kết nối, máy đồng bộ Zalo PC, file đính kèm, sao lưu và nhật ký; thu nhỏ file dữ liệu để tin đã xóa không còn trên ổ đĩa. Giữ tài khoản nhân viên, bộ phận, nhóm quyền. Xong app tự khởi động lại.
- **Xóa kênh: hỏi giữ hay xóa luôn tin nhắn**. Bấm "Xóa kênh" hiện 2 lựa chọn: **Xóa kênh, giữ tin nhắn** (như trước, tên kênh kèm "(đã xóa)") hoặc **Xóa kênh và toàn bộ tin nhắn** (xóa hẳn hội thoại, tin, chỉ mục tìm kiếm của kênh, hỏi lại trước khi xóa). Xóa kênh cũng dừng việc đồng bộ Zalo PC đang chờ của kênh đó.

## v3.29.1 — 27/10/2026

- **Cài máy đồng bộ Zalo PC chỉ bằng vài cú bấm**: Cài đặt › Kết nối kênh › Máy đồng bộ Zalo PC › **Thêm máy** › **Tải bộ cài** (.zip). Giải nén, bấm đúp **CAI DAT.cmd** là xong: tự cài Node.js nếu máy chưa có, tự gắn mã máy (không phải chép mã / gõ lệnh), chạy nền và tự chạy khi mở máy. Bộ cài kèm **GO CAI DAT.cmd** để gỡ. Nút **Bộ cài** cạnh mỗi máy để tải lại (đổi mã, bộ cũ hết hiệu lực).

## v3.29.0 — 27/10/2026

- **Nút "Đồng bộ tin nhắn cũ" lấy luôn tin cũ từ Zalo PC**: chỉ cần một máy tính có Zalo PC đăng nhập **cùng tài khoản Zalo** với kênh. Bấm nút → app giao việc → máy đó tự đọc 90 ngày gần nhất từ Zalo PC và nhập lên; dưới nút hiện tiến độ (đang chờ máy / máy … đang đọc x/y hội thoại, đã nhập n tin / xong), có nút **Hủy**. Máy đang mở Zalo PC tài khoản khác thì không nhận và app ghi rõ lý do. Kênh đang mất kết nối (đã từng quét QR) vẫn bấm đồng bộ qua Zalo PC được.
- **Máy đồng bộ Zalo PC** (Cài đặt › Kết nối kênh, Super Admin): **Thêm máy** → tải chương trình `dong-bo-zalo-pc.mjs` + chép một lệnh chạy trên máy có Zalo PC (cần Node.js). Chương trình chạy nền, tự chạy khi mở máy, hỏi app mỗi 10 giây; mã máy chỉ dùng được cho việc đồng bộ, xóa máy là mã hết hiệu lực. Danh sách máy hiện đang bật / tắt, Zalo PC đang mở kênh nào.
- Hướng dẫn cập nhật: `docs/them-kenh-zalo-va-nhap-lich-su.md`.

## v3.28.1 — 27/10/2026

- **Trợ lý AI dùng được DeepSeek**: ô Nhà cung cấp AI có thêm DeepSeek (cạnh Claude, Grok). Lưu khóa DeepSeek (`sk-…`) là app tự lấy danh sách model của tài khoản, chọn sẵn model nhanh ("flash") để chấm từng hội thoại và model mạnh hơn ("pro") để tổng hợp cuối ngày. Tài khoản hết tiền thì báo rõ "hết tiền, nạp thêm".

## v3.28.0 — 27/10/2026

- **Nhập lịch sử tin nhắn cũ từ Zalo PC**: Zalo web (cách app kết nối) chỉ cho lấy tin kể từ lúc tài khoản được gắn vào app; Zalo PC thì có lịch sử điện thoại đồng bộ sang. Công cụ mới `npm run nhap-zalo-pc` (chạy trên laptop có Zalo PC đăng nhập đúng tài khoản của kênh) mở lại Zalo PC ở chế độ đọc dữ liệu chỉ trong máy, đọc tin mọi hội thoại cá nhân + nhóm trong 90 ngày (đổi bằng `-- --ngay 30`), gửi lên app rồi mở lại Zalo PC bình thường. `-- --thu`: chỉ đọc và đếm.
  - App chỉ nhận đúng tài khoản Zalo của kênh, chỉ Super Admin; tin cũ lưu lặng lẽ (không chưa đọc, không cảnh báo / webhook), tin đã có bỏ qua; tên + ảnh khách, tên nhóm lấy từ Zalo PC. Ảnh, file, video, sticker, link, vị trí, trích dẫn hiển thị như tin thường; tin thu hồi bỏ qua.
  - Đã thử với acc ZALO HAU: 90 ngày = khoảng 99.000 tin / 285 hội thoại; đọc khoảng 4–5 phút.

## v3.27.0 — 27/10/2026

- **Chấm tư vấn theo kịch bản (AI)**: AI đọc từng phiên chat ở mọi kênh, chấm từng bước của kịch bản công ty (Đạt / Không đạt / Không áp dụng / Không chấm). Bước "Đạt" phải kèm câu trích nguyên văn của nhân viên, máy chủ kiểm lại; điểm do máy chủ tính (số bước đạt ÷ số bước được tính). Thiếu dữ liệu thì không chấm (chưa trả lời, khách nhắn quá ít, thiếu đoạn đầu khi Zalo mới gắn vào app). Kết quả lưu theo nội dung phiên, không có tin mới thì không chấm lại.
  - Cài đặt › Chấm tư vấn (kịch bản): sửa các bước, tiêu chí, câu mẫu, mốc Đạt chuẩn / Cần cải thiện, bật tự chấm. Sửa kịch bản thì lên bản mới.
  - Báo cáo › Chất lượng tư vấn: điểm trung bình, số phiên Đạt chuẩn / Cần cải thiện / Chưa đạt, khách chưa được trả lời, khách chưa nhắn lại, % đạt từng bước, theo từng nhân viên; bấm số / bước / nhân viên là ra đúng các phiên đó; xem chi tiết từng bước kèm câu trích (bấm để mở đúng tin); quản lý sửa kết quả hoặc cho AI chấm lại; chấm khoảng ngày cũ; xuất Excel.
  - Quyền mới: "Xem chất lượng tư vấn" và "Sửa kịch bản chấm tư vấn…" (cấp sẵn cho nhóm Quản trị). Nhân viên không xem được.
- **Trợ lý AI dùng được Grok (xAI)**: Cài đặt › Zalo nhân viên (giám sát) › Trợ lý AI có ô chọn nhà cung cấp Claude (Anthropic) hoặc Grok (xAI), mỗi bên một khóa riêng (khóa bên kia vẫn giữ). Lưu khóa Grok là app tự lấy danh sách model của tài khoản. Giám sát Zalo nhân viên và chấm tư vấn đều dùng bên đang chọn, chung giới hạn lượt mỗi ngày.
- Bản demo: `node scripts/demo.mjs --mock-ai` dùng máy AI giả (Claude và Grok) để thử các tính năng AI, không tốn tiền.
- Thao tác đúng lúc máy chủ đang khởi động lại (cập nhật bản mới) hoặc NAS mất mạng: báo "Máy chủ đang khởi động lại hoặc mất kết nối… đợi khoảng 30 giây rồi thử lại" thay vì chỉ hiện "Lỗi 530".

## v3.26.3 — 27/10/2026

- NAS (`cap-nhat.sh`): tự sửa lỗi web báo Cloudflare 1033 sau khi dừng / bật tay container — container app hoặc đường hầm còn chạy trên mạng cũ của `chat-sieutoc-net` thì tự khởi động lại (mỗi phút kiểm một lần). Cần chép `cap-nhat.sh.moi` đè lên `cap-nhat.sh` trên NAS một lần. `SU-CO.md` thêm mục E (lỗi 1033).
- Đã kiểm thực tế bù tin (v3.26.2): dừng app vài phút, nhắn thử vào Zalo SR, bật lại → app bù đủ 5 tin.

## v3.26.2 — 27/10/2026

- **Bù tin khi app / NAS tắt hoặc mất mạng**: kết nối lại Zalo là app hỏi Zalo các tin kể từ tin mới nhất đã có, lật tiếp đến hiện tại, rồi đưa vào hộp thư như tin mới (chưa đọc, cảnh báo). Trước đây app hỏi không kèm mốc nên Zalo luôn trả cùng một lô tin cũ (12–15/10), tin khách nhắn trong lúc tắt không được bù. Nhật ký ghi rõ mỗi lần bù: từ lúc nào, Zalo trả bao nhiêu tin, thêm mới bao nhiêu.

## v3.26.1 — 26/10/2026

- Cài đặt: đổi tên mục "Bộ phận (phân chia hội thoại)" thành "Bộ phận - phân chia hội thoại".

## v3.26.0 — 26/10/2026

- **Khung Tài khoản**: bấm avatar ở góc dưới thanh bên trái để mở. Trong khung: tên, quyền, tên đăng nhập; **đổi / bỏ ảnh đại diện**; chọn giao diện **Sáng / Tối / Theo máy**; đổi mật khẩu (tài khoản nội bộ); **đăng xuất mọi thiết bị**; đăng xuất. Nút đổi mật khẩu và nút giao diện riêng ở thanh bên được gom vào khung này.
- Ảnh đại diện: chọn ảnh bất kỳ, app tự cắt vuông giữa ảnh và thu nhỏ còn 256×256 trước khi tải lên (nhận PNG / JPG / WebP, tối đa 1 MB). Ảnh hiện ở thanh bên, danh sách nhân viên, nhóm quyền, bộ phận, giao hội thoại; người khác thấy ngay không cần tải lại trang. Điện thoại: Thêm › Đổi ảnh đại diện.

## v3.25.0 — 23/10/2026

- **Giao diện sáng / tối**: chọn **Sáng**, **Tối** hoặc **Theo máy** (tự đổi theo cài đặt sáng / tối của Windows, điện thoại). Máy tính: nút mặt trời / mặt trăng ở thanh bên trái (cạnh nút đăng xuất), bấm để chuyển. Điện thoại: Thêm › Giao diện. Lựa chọn lưu riêng trên từng máy; mở app là đúng giao diện ngay, không nháy trắng.

## v3.24.1 — 23/10/2026

- **Phân quyền gọn lại**: bỏ 2 quyền của tính năng đang tạm ẩn — "Lên đơn hàng POS (Odoo) từ hội thoại" và "Chấm điểm chất lượng tư vấn". Không còn hiện trong Nhóm quyền / quyền riêng của nhân viên và không cấp cho ai (kể cả nhóm đã tick trước đây), trừ Super Admin. Trang Dữ liệu › Nhân viên bỏ cột "Điểm đánh giá" (luôn trống). Mô tả nhóm "Trưởng nhóm" bỏ chữ "chấm điểm".
- Khi hiện lại 2 tính năng này thì 2 quyền tự hiện lại (`web/src/features.ts` + `hidden` trong `server/src/permissions.ts`).

## v3.24.0 — 23/10/2026

- **Gửi tin hiện ngay**: bấm Gửi là tin hiện liền trong khung chat (mờ, "Đang gửi…"), ô nhập xóa ngay để gõ tin tiếp — không còn chờ Zalo trả lời mới cho gõ. Tin gửi đi đúng thứ tự. Gửi lỗi thì tin báo đỏ "Chưa gửi được" kèm nút **Gửi lại** / **Bỏ**; chuyển sang hội thoại khác rồi quay lại vẫn còn. Đóng / tải lại trang khi còn tin đang gửi thì trình duyệt hỏi lại.
- File giao diện không có: trả 404 gọn, không ghi lỗi vào nhật ký.

## v3.23.0 — 23/10/2026

- **Tìm tin nhắn nhanh** khi có hàng trăm nghìn tin: chỉ mục tìm kiếm toàn văn (FTS5, cụm 3 ký tự, không dấu). Thử 200.000 tin: tìm một cụm từ từ ~1,4 giây còn ~3 ms; gõ có dấu / không dấu đều ra. Áp dụng cho ô tìm tin nhắn, ô tìm hội thoại, tìm trong Zalo nhân viên. Tin cũ tự đưa vào chỉ mục nền lúc khởi động; từ khóa dưới 3 ký tự tìm theo cách cũ.
- **Danh sách hội thoại mượt hơn**: mỗi dòng chỉ vẽ lại khi chính nó đổi (trước đây cả danh sách vẽ lại mỗi khi có người gõ, tin mới, cảnh báo); trình duyệt bỏ qua vẽ các dòng ngoài màn hình; máy chủ gộp tín hiệu "đang xem / đang gõ".
- NAS: chuẩn bị chạy app không cần quyền root (`docker-compose.yml` có `user: 1000:1000`, bỏ đặc quyền) — làm theo `deploy/nas/CHAY-KHONG-ROOT.md`. `cap-nhat.sh` dựng lại container sạch cả khi chỉ đổi cấu hình.

## v3.22.0 — 22/10/2026

Rà soát bảo mật và hiệu năng toàn app.

**Bảo mật**
- Chống dò mật khẩu theo IP thật của người dùng (qua Cloudflare): một IP sai 5 lần với một tài khoản, hoặc 20 lần với nhiều tài khoản thì bị chặn 10 phút; người khác không còn khóa được tài khoản của mình.
- Tài khoản portal của Odoo (khách hàng, đối tác) không đăng nhập được app.
- Nhóm quyền: người có quyền phân quyền không tự thêm mình / người khác vào nhóm có quyền mình không có, không xóa nhóm đó.
- Không tự gán thêm kênh / bộ phận cho chính mình; chỉ Super Admin đặt lại mật khẩu tài khoản nội bộ; không tạo tài khoản nội bộ dạng email.
- Zalo nhân viên (giám sát) chỉ được xem: chặn gửi sticker, thả cảm xúc, thu hồi, chuyển tiếp thay nhân viên; API không gửi tin qua Zalo nhân viên; chỉ Super Admin chuyển Zalo nhân viên thành kênh chung.
- Khóa / xóa / đăng xuất mọi nơi: kết nối realtime đang mở bị ngắt ngay (trước đây vẫn nhận tin mới).
- Mã link tạm (tải file) chỉ dùng để xem / tải, không gửi tin hay sửa dữ liệu.
- Link trong tin khách gửi không được trỏ vào /api của app.
- Tải ảnh / tệp mẫu và webhook không gọi được vào mạng nội bộ của NAS (chặn cả kiểu viết IPv6, kiểm lúc kết nối).
- Kiểm tra kết nối Odoo POS không gửi API key đã lưu sang địa chỉ khác.
- Xuất CSV: ô bắt đầu bằng = + - @ không chạy như công thức Excel. Nhập Excel: chặn file "bom nén".
- Nhật ký: che thêm API key, cookie Zalo; lỗi trình duyệt không giả được dòng nhật ký, không gửi SĐT khách trong đường dẫn.
- Lỗi kỹ thuật không trả nguyên văn ra ngoài; file khách gửi không cho Cloudflare lưu tạm.
- Tag / câu trả lời mẫu: chỉ sửa / xóa được mục thuộc phạm vi bộ phận mình.
- Triển khai: GitHub chỉ build từ tag phát hành, các bước build ghim cố định phiên bản; `cap-nhat.sh` không tự thay bằng bản trong ảnh (lưu ra `cap-nhat.sh.moi` để quản trị viên duyệt).

**Hiệu năng**
- Thêm chỉ mục cho danh sách hội thoại, báo cáo theo ngày, nhật ký, giám sát, tìm theo SĐT; SQLite dùng bộ đệm lớn hơn, dùng lại câu lệnh đã biên dịch.
- Sao lưu mỗi giờ chạy nền (không làm app khựng khi dữ liệu lớn).
- Xuất dữ liệu nhanh hơn nhiều khi có nhiều tin nhắn; quét cảnh báo gộp lại khi đồng bộ nhiều đơn.
- Giao diện: các trang Báo cáo, Giám sát tải riêng khi mở.

**Sửa lỗi**
- App khởi động lỗi trên cơ sở dữ liệu mới tinh (ảnh hưởng khi dựng lại từ đầu / chạy tạm laptop với dữ liệu trống).

## v3.21.3 — 22/10/2026

- NAS: hết chấm đỏ ở dự án `chat-sieutoc` trong Container Manager. Khi có bản mới, `cap-nhat.sh` gỡ hẳn container cũ rồi tạo mới (không còn container tên tạm `<mã>_chat-sieutoc` làm Container Manager báo lỗi), không cho hai lượt chạy chồng nhau, dọn container và ảnh cũ còn sót.
- `cap-nhat.sh` đi kèm bản build và **tự thay bằng bản mới** sau mỗi lần cập nhật, không phải chép tay lên NAS nữa.

## v3.21.2 — 22/10/2026

- Sửa lỗi nút **Cảnh báo (1)** bấm vào không thấy hội thoại nào: cảnh báo thuộc hội thoại đã xóa khỏi hộp thư hoặc kênh đã xóa / tắt giờ tự đóng và không còn được đếm. Xóa hội thoại, xóa hoặc tắt kênh là cảnh báo của nó đóng ngay.

## v3.21.1 — 21/10/2026

- **Xóa hàng loạt** tag và câu trả lời mẫu: tick nhiều dòng → **Xóa N tag / Xóa N mẫu** (hỏi lại trước khi xóa; tag bị xóa được gỡ khỏi các hội thoại đang gắn). Có ghi nhật ký.
- Sửa lỗi: hội thoại đã xóa khỏi hộp thư, nhân viên nhắn tiếp thì sau khi tải lại trang (F5) bị ẩn mất. Giờ nhân viên nhắn tiếp (từ app hoặc điện thoại) là hội thoại hiện lại như khi khách nhắn. Các hội thoại đang bị ẩn vì lỗi này tự hiện lại khi cập nhật.

## v3.21.0 — 21/10/2026

- **Tag** và **Câu trả lời mẫu** (Cài đặt): thêm ô **tìm** (tên tag / từ viết tắt, nội dung, không cần gõ dấu) và **lọc theo bộ phận** (mọi bộ phận / dùng chung / từng bộ phận).
- **Sửa bộ phận hàng loạt**: tick nhiều dòng (hoặc ô chọn tất cả những dòng đang lọc) rồi chọn **Thêm bộ phận**, **Bỏ bộ phận** hoặc **Đặt lại bộ phận** → Áp dụng. Đặt lại mà không chọn bộ phận nào = dùng chung cho mọi bộ phận. Có ghi nhật ký.

## v3.20.0 — 21/10/2026

- **Xóa tài khoản nhân viên** (chỉ Super Admin): Cài đặt › Nhân viên › Sửa › **Xóa tài khoản**. Người đó mất quyền vào app ngay, biến khỏi danh sách, mất nhóm quyền / bộ phận / kênh; hội thoại đang mở họ nhận trả về "Chưa nhận". Tin nhắn, ghi chú, báo cáo cũ vẫn giữ tên họ. Không xóa được chính mình và Super Admin khác (bỏ quyền trước). Có ghi nhật ký.
- Tài khoản Odoo đã xóa mà đăng nhập lại thì vào như nhân viên mới; muốn chặn hẳn thì khóa (bỏ "Cho phép đăng nhập") thay vì xóa.

## v3.19.0 — 21/10/2026

- **Đăng nhập bằng Odoo vào được ngay**: ai có tài khoản Odoo đăng nhập lần đầu là vào app luôn với nhóm quyền **Nhân viên CSKH** (không còn phải chờ quản trị viên duyệt). Người đã đăng ký từ hồi phải chờ duyệt cũng vào được ở lần đăng nhập tới. Tài khoản bị quản trị viên khóa vẫn không vào được. Quản trị viên đổi quyền, bộ phận, kênh trong Cài đặt › Nhân viên.

## v3.18.6 — 21/10/2026

- Khung **Thông tin** của hội thoại tạm ẩn mục **Đơn hàng** (nút Lên đơn POS, Mã khách hàng) và **Đánh giá chất lượng tư vấn** vì chưa dùng tới. Dữ liệu cũ vẫn giữ; bật lại bằng `SHOW_ORDERS` / `SHOW_REVIEWS` trong `web/src/pages/Inbox.tsx`.

## v3.18.5 — 21/10/2026

- Cài đặt gọn hơn: gộp **Kết nối app nội bộ**, **API & Webhook**, **App nền tảng** thành một mục **Kết nối app & API**, bên trong chia 3 thẻ. Link cũ (`#/settings/apps`, `integrations`, `linked`) vẫn mở đúng thẻ.

## v3.18.4 — 21/10/2026

- **Sao lưu tự động** trong app: `data/backups/auto/app-moi-nhat.db` ghi mỗi giờ, `app-YYYY-MM-DD.db` mỗi đêm (giữ 14 ngày). NAS đẩy thư mục này lên Google Drive bằng Cloud Sync.
- Phương án sự cố NAS: hướng dẫn `deploy/nas/SU-CO.md` và lệnh `node scripts/chay-tam-laptop.mjs <bản sao lưu>` để laptop chạy thay khi NAS hỏng (tự kiểm tra NAS đã tắt, nạp bản sao lưu, bật app + tunnel).

## v3.18.3 — 21/10/2026

- Danh sách **Hội thoại**: mỗi hội thoại có nhãn **tên kênh** (vd. Zalo SR, kênh Zalo nhân viên) ở đầu dòng nhãn, luôn hiện để biết tin thuộc kênh nào khi có nhiều kênh. Tên dài tự rút gọn, rê chuột xem đủ.

## v3.18.2 — 20/10/2026

- Không còn bị **đăng xuất** khi mở app đúng lúc máy chủ đang khởi động lại (NAS tự cập nhật bản mới, mất mạng): app hiện "Đang kết nối máy chủ…" rồi tự vào lại; chỉ bắt đăng nhập lại khi phiên thật sự hết hạn.
- Bản demo trên máy phát triển (`node scripts/demo.mjs`): dữ liệu sao chép đã bỏ phiên Zalo, webhook, kết nối app nội bộ, để chỉnh giao diện và tính năng mà không đụng app thật.

## v3.18.1 — 20/10/2026

- Đồng bộ tin cũ lật trang đúng chiều Zalo trả (xuôi từ lúc tài khoản được gắn → mới nhất): ít lượt gọi hơn hẳn (Zalo SR từ 67 lượt còn vài lượt).
- Nhật ký ghi mã lỗi Zalo khi lấy lịch sử nhóm thất bại.

## v3.18.0 — 20/10/2026

- Đồng bộ tin nhắn cũ lấy **lịch sử nhóm từ đám mây của Zalo** (cách chat.zalo.me tải tin nhóm, không cần điện thoại): mỗi nhóm lấy lô mới nhất rồi lùi dần, tối đa 90 ngày / 1.000 tin mỗi nhóm. Thay cho API lịch sử nhóm cũ đã bị Zalo khóa (lỗi 404).

## v3.17.2 — 20/10/2026

- **Nhật ký hoạt động Zalo** chi tiết hơn (Cài đặt › Nhật ký hệ thống, lọc theo `zalo#<số kênh>`): đăng nhập lại / quét QR / kết nối / mất kết nối, Zalo gửi bù tin, từng lô khi đồng bộ tin cũ (số tin, khoảng thời gian, thêm mới bao nhiêu), lỗi và tổng kết. Nhật ký giữ được qua các lần app khởi động lại (cập nhật bản mới, mất điện).
- Đồng bộ tin nhắn cũ: lô đầu trống thì thử lại một lần; API lịch sử nhóm của Zalo hiện báo lỗi 404 nên app dừng sau 3 nhóm lỗi thay vì gọi dồn hàng trăm nhóm; khi Zalo không trả tin nào thì báo rõ lý do (Zalo chỉ giữ tin từ lúc tài khoản được gắn vào app).

## v3.17.1 — 20/10/2026

- Đồng bộ tin nhắn cũ lùi xa hơn, giống Zalo Web lúc mới đăng nhập: lật tối đa 80 lô tin, lô nào toàn tin đã có thì vẫn lùi tiếp thay vì dừng sớm.

## v3.17.0 — 20/10/2026

- **Đồng bộ tin nhắn cũ** của Zalo: vừa quét QR gắn tài khoản Zalo vào kênh là app tự kéo các tin cũ Zalo còn giữ trên máy chủ (tin cá nhân + nhóm, tối đa 90 ngày) để nhân viên biết mà chat tiếp. Trên thẻ kênh (Cài đặt › Kết nối kênh) có nút **Đồng bộ tin nhắn cũ** để chạy lại bất cứ lúc nào, kèm tiến độ và kết quả. Tin đã có thì bỏ qua, không nhân đôi; tin cũ không bắn webhook / cảnh báo / thông báo và không tính là chưa đọc.
- Lấy tên và ảnh khách mới lần lượt từng người (tránh gọi Zalo dồn dập khi có nhiều khách cùng lúc).

## v3.16.0 — 20/10/2026

- **Xóa được kênh còn hội thoại**: super admin bấm Xóa kênh thì Zalo của kênh được đăng xuất (xóa cookie), kênh biến mất khỏi Kết nối kênh / Zalo nhân viên / Giám sát. Toàn bộ hội thoại và tin nhắn cũ vẫn giữ: xem lại trong Hội thoại, Báo cáo, Xuất dữ liệu, tên kênh kèm "(đã xóa)". Kênh chưa có hội thoại thì xóa hẳn như trước. Có ghi nhật ký.
- Gắn lại tài khoản Zalo của kênh đã xóa vào kênh mới được, không còn báo trùng.

## v3.15.5 — 20/10/2026

- NAS **tự cập nhật** bản mới: mỗi lần phát hành, GitHub tự build sẵn bản cho NAS (`.github/workflows/nas-image.yml`); trên NAS, `cap-nhat.sh` chạy vài phút một lần (Bộ lập lịch tác vụ của DSM), thấy bản mới thì tự đổi, app chỉ ngừng khoảng 20–30 giây. Giữ bản cố định / quay về bản cũ bằng `APP_TAG`.
- Bỏ lệnh `npm run nas:update` (không còn phải chép mã nguồn tay lên NAS).
- Trang phiên bản hiện mã commit khi chạy trong container.

## v3.15.4 — 20/10/2026

- NAS: app và Cloudflare Tunnel chạy trong mạng riêng, không còn dùng cổng 3000 của NAS (trước đây nếu app khác trên NAS đã chiếm cổng 3000 thì tên miền sẽ trỏ nhầm sang app đó). Trong mạng nội bộ mở app qua cổng 3100.

## v3.15.3 — 20/10/2026

- Chạy được trên **Synology NAS** (Container Manager): thêm `deploy/nas/docker-compose.yml` (app + Cloudflare Tunnel) và hướng dẫn `deploy/nas/HUONG-DAN.md`.
- Lệnh `npm run nas:export` dừng app trên máy này và gói mã nguồn + dữ liệu + cấu hình để chép lên NAS; `npm run nas:update` gói mã nguồn bản mới để cập nhật.
- Sửa file Docker: build được giao diện và hiện đúng số phiên bản khi chạy trong container.

## v3.15.2 — 19/10/2026

- Bỏ mục **Báo cáo công việc** khỏi thanh menu (máy tính và tấm "Thêm" trên điện thoại). Kết nối với app Báo cáo công việc CSKH vẫn giữ: app đó vẫn đăng nhập qua Chat Siêu Tốc và lấy số liệu chat như cũ.

## v3.15.1 — 17/10/2026

- Ô chọn kênh ở góc trên chỉ hiện trong trang **Hội thoại** (nơi nó có tác dụng); các trang Kênh Chat, Giám sát, Báo cáo, Cài đặt không còn hiện.

## v3.15.0 — 17/10/2026

**Zalo nhân viên hiện ngay trong Hội thoại**
- Người có quyền Giám sát thấy hội thoại Zalo nhân viên trong hộp thư Hội thoại như một kênh, xem cùng lúc với kênh CSKH. Ô chọn kênh ở góc trên có nhóm **Zalo nhân viên (chỉ xem)**, chọn nhiều kênh cùng lúc (vd: chỉ Zalo SR + Zalo của 2 nhân viên).
- Hội thoại Zalo nhân viên có nhãn **Zalo NV · tên nhân viên**; mở ra là **chỉ xem**: không ô soạn tin, không nhận việc / đổi trạng thái / lên đơn, có khung **Phân tích AI** và nút mở trong trang Giám sát. Mỗi lần mở xem được ghi nhật ký như trang Giám sát.
- Chặn dùng Zalo của nhân viên để tra số, kết bạn, xem bạn bè, tạo nhóm… nếu không phải người giữ máy (kể cả Super Admin).

**Xuất tin nhắn theo khách hàng và nhóm chat**
- Mọi file xuất có trường **Loại chat: Khách 1-1 / Nhóm**, cùng kênh, loại kênh (CSKH chung / Zalo nhân viên), SĐT khách, **người gửi** (tên thành viên trong nhóm).
- Lọc **Chỉ khách chat 1-1 / Chỉ nhóm chat**; TXT chia 2 phần **Khách chat 1-1** và **Nhóm chat** (nhóm có danh sách thành viên đã nhắn).
- File mới **Tổng hợp theo khách hàng & nhóm (Excel)**: trang Khách 1-1 (mỗi khách một dòng: SĐT, mã KH, kênh, số tin khách / shop, lần đầu / cuối, nhân viên, trạng thái, tag, đánh giá, tóm tắt AI), trang Nhóm chat (số người nhắn, thành viên), trang Tin nhắn có cột Loại chat để lọc.
- Ô **Gồm Zalo nhân viên (giám sát)** khi xuất. Sửa lỗi cũ: người chỉ có quyền Xuất dữ liệu trước đây xuất được cả tin Zalo nhân viên — nay chỉ người có quyền Giám sát mới xuất được.

## v3.14.0 — 17/10/2026

**Mục Báo cáo (thay cho Dữ liệu): biểu đồ + báo cáo ở một chỗ**
- **Tổng quan**: khách nhắn, tin khách / tin shop, phản hồi trung bình và % trả lời trong 5 phút, cảnh báo đơn "rơi" đã xử lý / phát sinh, đơn hàng gắn hội thoại. Biểu đồ tin nhắn theo ngày, khách mới / khách cũ quay lại, thời gian phản hồi theo ngày, **giờ cao điểm khách nhắn** (thứ × giờ, để xếp ca trực), theo kênh, tag hội thoại, cảnh báo đơn "rơi" theo loại, đơn hàng theo ngày và theo nguồn (POS từ chat / Sapo / web).
- **Nhân viên**: biểu đồ tin đã gửi và thời gian phản hồi của từng người + bảng hiệu suất như cũ (tải hội thoại từng người).
- **Giám sát** (người có quyền giám sát): khách, tin, tin thu hồi, tin cần chú ý (AI / quy tắc), điểm tư vấn AI; biểu đồ tin theo ngày, tin cần chú ý theo ngày, mức rủi ro, loại vấn đề, kết quả hội thoại; bảng theo nhân viên, xuất Excel riêng từng người.
- **Xuất dữ liệu & báo cáo**: báo cáo giám sát (Excel), mở app Báo cáo công việc CSKH, xuất dữ liệu hội thoại TXT / CSV / JSONL / JSON như cũ.
- Lọc chung theo hôm nay / 7 / 30 / 90 ngày hoặc khoảng tùy chọn, theo kênh, bộ phận. Rê chuột / chạm vào biểu đồ để xem số từng ngày; dùng tốt trên điện thoại.

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
